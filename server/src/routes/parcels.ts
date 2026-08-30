import { Router } from 'express'
import mongoose from 'mongoose'
import {
  bookParcelInputSchema,
  quoteInputSchema,
  type AddressInput,
  type DeliveryStatus,
  type GeocodedAddress,
  type ParcelListItem,
  type RecentRecipient,
  type ZoneName,
} from '@pdms/shared'
import { runAsSystem } from '../lib/context'
import { geocodeAddress } from '../lib/geocode'
import { routeBetween } from '../lib/routing'
import { DeliveryModel } from '../models/Delivery'
import { ParcelModel } from '../models/Parcel'
import { UserModel } from '../models/User'
import { requireAuth, requireRole } from '../middleware/auth'
import { HttpError, unauthorized } from '../middleware/httpError'
import { autoAssignAfterBooking } from '../services/assignment'
import { createPaymentForParcel, summariesForParcels } from '../services/payments'
import { priceFor } from '../services/pricing'
import { availableTransitions, promisedBy } from '../services/lifecycle'
import { generateTrackingId } from '../services/trackingId'

export const parcelsRouter = Router()

interface SavedAddressLean {
  _id: mongoose.Types.ObjectId
  line1: string
  area: string
  zone?: ZoneName
  city: string
  point?: GeocodedAddress['point']
  resolvedLabel?: string
}

/**
 * Resolve the pick-up point, skipping Nominatim when `savedAddressId` names
 * one of the CALLER'S OWN saved addresses whose location fields still match
 * `pickup` word for word AND already carries a stored point (M9.9).
 *
 * The match check is what keeps this safe: a client-supplied coordinate is
 * never trusted for pricing on its own (same reasoning as the codAmount
 * integrity fix in M6.9) — what is trusted here is a point THIS SERVER
 * resolved earlier and stored against a record it already scoped to this
 * actor, reused only when the address it was resolved from is still exactly
 * what is being submitted now. An edited address, a wrong or deleted id, or
 * one that has simply never been geocoded before all fall straight through
 * to a normal `geocodeAddress` call — this is an optimisation, never a
 * dependency.
 *
 * `matched` (regardless of whether a point existed yet to reuse) is what the
 * booking route uses to decide whether this use should stamp `lastUsedAt` —
 * see POST / below.
 */
const resolvePickupGeo = async (
  actorId: string,
  pickup: AddressInput,
  savedAddressId?: string,
): Promise<{ geo: GeocodedAddress; matched: boolean }> => {
  let saved: SavedAddressLean | undefined
  if (savedAddressId) {
    const user = await UserModel.findById(actorId)
      .select('savedAddresses')
      .lean<{ savedAddresses: SavedAddressLean[] } | null>()
      .exec()
    saved = user?.savedAddresses.find((a) => a._id.toString() === savedAddressId)
  }

  const matched =
    saved !== undefined &&
    saved.line1 === pickup.line1 &&
    saved.area === pickup.area &&
    saved.zone === pickup.zone &&
    saved.city === pickup.city

  if (matched && saved?.point) {
    return { geo: { point: saved.point, resolvedLabel: saved.resolvedLabel ?? '' }, matched: true }
  }

  const geo = await geocodeAddress(pickup, 'pickup')

  if (matched && savedAddressId) {
    // Best-effort backfill so the NEXT use of this saved address can skip
    // straight to the point above. A failure here must not fail a booking
    // or quote that has otherwise succeeded — it only costs the shortcut.
    try {
      await UserModel.updateOne(
        { _id: actorId, 'savedAddresses._id': savedAddressId },
        {
          $set: {
            'savedAddresses.$.point': geo.point,
            'savedAddresses.$.resolvedLabel': geo.resolvedLabel,
          },
        },
      ).exec()
    } catch {
      // Optimisation only — see above.
    }
  }

  return { geo, matched }
}

/**
 * Geocode both ends and measure the road distance between them.
 *
 * Sequential, not parallel: Nominatim allows one request per second, and the
 * throttle would serialise them anyway — awaiting in order just makes the
 * failure attributable to the address that caused it.
 */
const measure = async (
  actorId: string,
  pickup: AddressInput,
  drop: AddressInput,
  pickupSavedAddressId?: string,
): Promise<{
  pickupGeo: GeocodedAddress
  dropGeo: GeocodedAddress
  distanceKm: number
  pickupMatched: boolean
}> => {
  const { geo: pickupGeo, matched: pickupMatched } = await resolvePickupGeo(
    actorId,
    pickup,
    pickupSavedAddressId,
  )
  const dropGeo = await geocodeAddress(drop, 'drop')
  const route = await routeBetween(pickupGeo.point, dropGeo.point)
  return { pickupGeo, dropGeo, distanceKm: route.distanceKm, pickupMatched }
}

/**
 * POST /parcels/quote — the estimate shown before final confirm.
 *
 * Takes the identical payload as booking, so a customer cannot be quoted from
 * one set of inputs and charged from another.
 */
parcelsRouter.post('/quote', requireAuth, requireRole('customer'), async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()
    const input = quoteInputSchema.parse(req.body)
    const { pickupGeo, dropGeo, distanceKm } = await measure(
      actor.id,
      input.pickup,
      input.drop,
      input.pickupSavedAddressId,
    )

    /**
     * The zone base is taken from the PICKUP zone: it represents the cost of
     * getting a rider to the parcel, which is a fact about where the journey
     * starts. Section 5 does not say which end, so this is a choice.
     */
    const price = await priceFor({
      distanceKm,
      weightKg: input.weightKg,
      zone: input.pickup.zone,
    })

    res.json({
      price,
      pickup: { resolvedLabel: pickupGeo.resolvedLabel },
      drop: { resolvedLabel: dropGeo.resolvedLabel },
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /parcels — book it.
 *
 * The price is recomputed here rather than accepted from the quote response.
 * A client could otherwise post back a cheaper figure, and re-running the
 * calculation costs nothing since both geocoding and distance are cached by
 * the time this runs.
 */
parcelsRouter.post('/', requireAuth, requireRole('customer'), async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()

    const input = bookParcelInputSchema.parse(req.body)
    const { pickupGeo, dropGeo, distanceKm, pickupMatched } = await measure(
      actor.id,
      input.pickup,
      input.drop,
      input.pickupSavedAddressId,
    )

    const price = await priceFor({
      distanceKm,
      weightKg: input.weightKg,
      zone: input.pickup.zone,
    })

    const trackingId = await generateTrackingId()
    const customerId = new mongoose.Types.ObjectId(actor.id)

    const parcel = await ParcelModel.create({
      trackingId,
      customer: customerId,
      pickup: { ...input.pickup, ...pickupGeo },
      drop: { ...input.drop, ...dropGeo },
      weightKg: input.weightKg,
      size: input.size,
      description: input.description,
      /**
       * The snapshot. Parcel.price is immutable on the schema, so a later
       * PricingConfig edit cannot reach back and change what this customer
       * was quoted (CLAUDE.md section 5).
       */
      price,
      isCod: input.isCod,
      /**
       * The collectable amount IS the snapshotted price, set here and never
       * read from the request. bookParcelInputSchema has no codAmount field
       * at all, so a client cannot under-declare what the rider is owed —
       * which it previously could, by simply posting a smaller number.
       */
      codAmount: input.isCod ? price.total : 0,
    })

    /**
     * The lifecycle record starts at Booked with its first event. Status is
     * set here only because this is creation, not a transition — every later
     * change goes through advanceStatus() in M3.
     */
    const delivery = await DeliveryModel.create({
      parcel: parcel._id,
      agent: null,
      status: 'Booked',
      events: [
        {
          status: 'Booked',
          at: new Date(),
          actor: customerId,
          actorRole: 'customer',
          point: pickupGeo.point,
        },
      ],
      assignedAt: null,
      pickedUpAt: null,
      deliveredAt: null,
      /**
       * The promise, set at booking. Left null until M6, which meant the
       * delayed-parcel alert could only ever fire on seeded data — a real
       * booking was never late because it was never due.
       */
      expectedBy: promisedBy(new Date()),
    })

    /**
     * The ledger row, created at booking for every parcel — COD included.
     *
     * Its amount comes from the price snapshot just written, never from a
     * later recomputation and never from the request: the whole point of the
     * snapshot is that this number cannot move afterwards.
     */
    const payment = await createPaymentForParcel({
      _id: parcel._id,
      trackingId: parcel.trackingId,
      customer: customerId,
      isCod: parcel.isCod,
      codAmount: parcel.codAmount,
      price: { total: parcel.price.total },
    })

    /**
     * Assign straight away (CLAUDE.md section 5).
     *
     * Runs as the system, not as the customer: a customer has no authority to
     * move a delivery to Assigned, and borrowing their identity would put a
     * false actor in the audit trail.
     *
     * Never throws. If nobody is free the parcel stays Booked and the admin
     * board flags it — the outcome is reported here so the customer is not
     * told a rider is coming when none is.
     */
    const assignment = await autoAssignAfterBooking({
      deliveryId: delivery._id.toString(),
    })

    /**
     * M9.9: a saved pick-up address counts as "used" only when the booking
     * actually went through with it unedited — `pickupMatched` is the same
     * check `resolvePickupGeo` used to decide whether to reuse its point.
     * Quoting never stamps this; only a real booking does. Best-effort, like
     * the point backfill above: this is what autofill reads to pick the
     * default next time, not something a booking can fail over.
     */
    if (pickupMatched && input.pickupSavedAddressId) {
      try {
        await UserModel.updateOne(
          { _id: customerId, 'savedAddresses._id': input.pickupSavedAddressId },
          { $set: { 'savedAddresses.$.lastUsedAt': new Date() } },
        ).exec()
      } catch {
        // Optimisation only — see resolvePickupGeo's own note.
      }
    }

    res.status(201).json({
      parcel: {
        _id: parcel._id.toString(),
        trackingId: parcel.trackingId,
        price: parcel.price,
        isCod: parcel.isCod,
      },
      payment,
      assignment,
    })
  } catch (err) {
    next(err)
  }
})

interface ParcelRow {
  _id: mongoose.Types.ObjectId
  trackingId: string
  pickup: { area: string }
  drop: { area: string }
  weightKg: number
  price: { total: number }
  isCod: boolean
  codAmount: number
  createdAt: Date
}

/**
 * GET /parcels — the customer's own list.
 *
 * No explicit customer filter: the roleScope query middleware adds it, so a
 * handler that forgets cannot leak another customer's parcels. Admins see all,
 * by the same mechanism.
 */
parcelsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const parcels = await ParcelModel.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<ParcelRow[]>()

    // Status lives on Delivery. Fetched as one extra query rather than an
    // aggregation, because aggregations bypass role scoping entirely.
    const deliveries = await DeliveryModel.find({
      parcel: { $in: parcels.map((p) => p._id) },
    })
      .select('parcel status')
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId
          parcel: mongoose.Types.ObjectId
          status: DeliveryStatus
        }>
      >()

    const byParcel = new Map(deliveries.map((d) => [d.parcel.toString(), d]))
    // One query for the page: the list has to say where every payment stands,
    // and a per-row lookup would be N round trips for a screen that is mostly
    // read on a phone.
    const paymentByParcel = await summariesForParcels(parcels.map((p) => p._id))
    const role = req.actor?.role ?? 'customer'

    const items: ParcelListItem[] = parcels.map((p) => {
      const d = byParcel.get(p._id.toString())
      const status: DeliveryStatus = d?.status ?? 'Booked'
      return {
        _id: p._id.toString(),
        deliveryId: d ? d._id.toString() : null,
        trackingId: p.trackingId,
        status,
        pickupArea: p.pickup.area,
        dropArea: p.drop.area,
        weightKg: p.weightKg,
        total: p.price.total,
        isCod: p.isCod,
        codAmount: p.codAmount,
        payment: paymentByParcel.get(p._id.toString()) ?? null,
        /**
         * From the server's own transition map, so the list can offer
         * "Cancel" only where cancelling is actually legal — and the server
         * still re-checks when it is clicked.
         */
        allowedTransitions: [...availableTransitions(status, role)],
        createdAt: p.createdAt,
      }
    })

    res.json({ parcels: items })
  } catch (err) {
    next(err)
  }
})

interface RecipientRow {
  drop: {
    contactName: string
    contactPhone: string
    line1: string
    area: string
    zone: ZoneName
    city: string
  }
  createdAt: Date
}

/** How many distinct recipients the booking form's drop-off autofill offers. */
const RECENT_RECIPIENTS_LIMIT = 8
/**
 * How far back to look for them. Generous relative to the limit above so a
 * customer who reuses only a handful of recipients still fills the chip row,
 * even though most of what it scans will be dropped as duplicates.
 */
const RECENT_RECIPIENTS_SCAN = 100

/**
 * GET /parcels/recent-recipients — the booking form's drop-off autofill
 * (M9.9). Derived entirely from the customer's own `Parcel.drop` fields —
 * no new model, per the brief.
 *
 * Scoped exactly like GET /parcels above: a plain `ParcelModel.find()`, no
 * aggregation, so the SAME roleScope rule (customer -> their own `customer`
 * field) applies here with nothing new to get wrong. Registered before
 * GET /:id so Express does not try to parse "recent-recipients" as an id.
 */
parcelsRouter.get(
  '/recent-recipients',
  requireAuth,
  requireRole('customer'),
  async (req, res, next) => {
    try {
      const rows = await ParcelModel.find()
        .select('drop createdAt')
        .sort({ createdAt: -1 })
        .limit(RECENT_RECIPIENTS_SCAN)
        .lean<RecipientRow[]>()

      // Rows arrive newest-first, so the first time a key is seen IS the most
      // recent use of that recipient — nothing to re-sort afterwards.
      const seen = new Map<string, RecentRecipient>()
      for (const row of rows) {
        const key = [
          row.drop.contactName.trim().toLowerCase(),
          row.drop.contactPhone,
          row.drop.line1.trim().toLowerCase(),
          row.drop.area.trim().toLowerCase(),
          row.drop.zone,
        ].join('|')
        if (seen.has(key)) continue
        seen.set(key, {
          recipientName: row.drop.contactName,
          recipientPhone: row.drop.contactPhone,
          dropLine1: row.drop.line1,
          dropArea: row.drop.area,
          dropZone: row.drop.zone,
          dropCity: row.drop.city,
          lastUsedAt: row.createdAt,
        })
        if (seen.size >= RECENT_RECIPIENTS_LIMIT) break
      }

      res.json({ recipients: [...seen.values()] })
    } catch (err) {
      next(err)
    }
  },
)

/** GET /parcels/:id — one parcel, scoped the same way. */
parcelsRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, 'not a valid parcel id')
    }
    const parcel = await ParcelModel.findById(id).lean()
    if (!parcel) throw new HttpError(404, 'parcel not found')

    const delivery = await DeliveryModel.findOne({ parcel: parcel._id })
      .select('status events agent')
      .lean()

    res.json({ parcel, delivery })
  } catch (err) {
    next(err)
  }
})
