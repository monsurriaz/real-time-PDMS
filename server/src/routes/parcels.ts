import { Router } from 'express'
import mongoose from 'mongoose'
import {
  bookParcelInputSchema,
  quoteInputSchema,
  type AddressInput,
  type DeliveryStatus,
  type GeocodedAddress,
  type ParcelListItem,
} from '@pdms/shared'
import { runAsSystem } from '../lib/context'
import { geocodeAddress } from '../lib/geocode'
import { routeBetween } from '../lib/routing'
import { DeliveryModel } from '../models/Delivery'
import { ParcelModel } from '../models/Parcel'
import { requireAuth, requireRole } from '../middleware/auth'
import { HttpError, unauthorized } from '../middleware/httpError'
import { autoAssignAfterBooking } from '../services/assignment'
import { priceFor } from '../services/pricing'
import { availableTransitions } from '../services/lifecycle'
import { generateTrackingId } from '../services/trackingId'

export const parcelsRouter = Router()

/**
 * Geocode both ends and measure the road distance between them.
 *
 * Sequential, not parallel: Nominatim allows one request per second, and the
 * throttle would serialise them anyway — awaiting in order just makes the
 * failure attributable to the address that caused it.
 */
const measure = async (
  pickup: AddressInput,
  drop: AddressInput,
): Promise<{
  pickupGeo: GeocodedAddress
  dropGeo: GeocodedAddress
  distanceKm: number
}> => {
  const pickupGeo = await geocodeAddress(pickup, 'pickup')
  const dropGeo = await geocodeAddress(drop, 'drop')
  const route = await routeBetween(pickupGeo.point, dropGeo.point)
  return { pickupGeo, dropGeo, distanceKm: route.distanceKm }
}

/**
 * POST /parcels/quote — the estimate shown before final confirm.
 *
 * Takes the identical payload as booking, so a customer cannot be quoted from
 * one set of inputs and charged from another.
 */
parcelsRouter.post('/quote', requireAuth, requireRole('customer'), async (req, res, next) => {
  try {
    const input = quoteInputSchema.parse(req.body)
    const { pickupGeo, dropGeo, distanceKm } = await measure(input.pickup, input.drop)

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
    const { pickupGeo, dropGeo, distanceKm } = await measure(input.pickup, input.drop)

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
      codAmount: input.codAmount,
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
      expectedBy: null,
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

    res.status(201).json({
      parcel: {
        _id: parcel._id.toString(),
        trackingId: parcel.trackingId,
        price: parcel.price,
      },
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
