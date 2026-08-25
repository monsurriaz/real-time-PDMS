import { Router } from 'express'
import mongoose from 'mongoose'
import type {
  DeliveryEvent,
  DeliveryStatus,
  GeoPoint,
  PublicTrackingSnapshot,
  Vehicle,
  ZoneName,
} from '@pdms/shared'
import { runAsSystem } from '../lib/context'
import { routeGeometry } from '../lib/routing'
import { AgentModel } from '../models/Agent'
import { DeliveryModel } from '../models/Delivery'
import { ParcelModel } from '../models/Parcel'
import { UserModel } from '../models/User'
import { requireAuth } from '../middleware/auth'
import { HttpError } from '../middleware/httpError'
import { outstandingChallenge } from '../services/pod'

export const trackingRouter = Router()

/**
 * Everything the live-tracking screen needs, in one scoped call.
 *
 * Also the REST fallback for section 6: when the socket drops the client polls
 * this every 10 seconds, so `delivery.lastKnownLocation` is the position it
 * falls back to. That is the position written on the 30-second persist
 * cadence, which is exactly why the UI must say it is polling — it is up to
 * half a minute behind what the socket would have shown.
 *
 * Scoping is the model's, not this handler's: a customer reaches only their own
 * parcels, a rider only their assignments, an admin anything.
 */

interface ParcelDoc {
  _id: mongoose.Types.ObjectId
  trackingId: string
  pickup: { area: string; zone: ZoneName; point?: GeoPoint }
  drop: { area: string; zone: ZoneName; contactName: string; point?: GeoPoint }
  weightKg: number
  isCod: boolean
  codAmount: number
  price: { total: number }
  createdAt: Date
}

interface DeliveryDoc {
  _id: mongoose.Types.ObjectId
  agent: mongoose.Types.ObjectId | null
  status: DeliveryStatus
  events: DeliveryEvent[]
  lastKnownLocation?: GeoPoint
  lastLocationAt?: Date
  expectedBy: Date | null
  proofOfDelivery?: unknown
}

/**
 * GET /tracking/by-id/:trackingId — v3's `/track/:trackingId`, public: no
 * session, no requireAuth, and by construction a smaller answer than the
 * authenticated snapshot below returns. What it deliberately withholds,
 * beyond the obvious (no OTP — that channel exists to prove the RIDER
 * reached the recipient, and anonymous is a third case beyond "owner" and
 * "admin" that also gets none of it):
 *
 *   - the recipient's name and phone (drop.contactName/contactPhone) — a
 *     third party's PII, not the tracker's business
 *   - street-level addresses (line1) — area + zone is enough to answer
 *     "where is it", and a bare tracking ID should not resolve to a house
 *   - weight, price and COD amount — financial/shipment detail nobody
 *     needs to locate a parcel
 *   - the rider's phone and the full event log's notes — an admin's or a
 *     rider's free text can name people or places the badge + rail already
 *     say without.
 *
 * Registered ahead of `/:parcelId` below for readability; the two never
 * collide since one is `/by-id/<id>` and the other `/<id>` — Express
 * matches on path shape, not registration order, when the shapes differ.
 */
trackingRouter.get('/by-id/:trackingId', async (req, res, next) => {
  try {
    const trackingIdParam = req.params.trackingId
    if (!trackingIdParam) throw new HttpError(400, 'a tracking ID is required')

    // Unscoped: there is no actor to scope to, and this route is meant to
    // answer for ANY parcel given its tracking ID, not just one this
    // (nonexistent) caller could otherwise see.
    const found = await runAsSystem('tracking: public lookup', async () => {
      const parcel = await ParcelModel.findOne({ trackingId: trackingIdParam })
        .select('trackingId pickup.area pickup.zone pickup.point drop.area drop.zone drop.point')
        .lean<{
          _id: mongoose.Types.ObjectId
          trackingId: string
          pickup: { area: string; zone: ZoneName; point?: GeoPoint }
          drop: { area: string; zone: ZoneName; point?: GeoPoint }
        } | null>()
        .exec()
      if (!parcel) return null

      const delivery = await DeliveryModel.findOne({ parcel: parcel._id })
        .select('agent status lastKnownLocation')
        .lean<{
          agent: mongoose.Types.ObjectId | null
          status: DeliveryStatus
          lastKnownLocation?: GeoPoint
        } | null>()
        .exec()
      if (!delivery) return null

      const rider = delivery.agent
        ? await (async () => {
            const agent = await AgentModel.findById(delivery.agent)
              .select('user vehicle')
              .lean<{ user: mongoose.Types.ObjectId; vehicle: Vehicle } | null>()
              .exec()
            if (!agent) return null
            const user = await UserModel.findById(agent.user)
              .select('name')
              .lean<{ name: string } | null>()
              .exec()
            return { name: user?.name ?? 'Unknown rider', vehicle: agent.vehicle }
          })()
        : null

      let route: Array<[number, number]> = []
      if (parcel.pickup.point && parcel.drop.point) {
        try {
          const geometry = await routeGeometry(parcel.pickup.point, parcel.drop.point)
          route = geometry.map((p) => p.coordinates)
        } catch {
          route = []
        }
      }

      const snapshot: PublicTrackingSnapshot = {
        trackingId: parcel.trackingId as PublicTrackingSnapshot['trackingId'],
        status: delivery.status,
        pickup: { area: parcel.pickup.area, zone: parcel.pickup.zone },
        drop: { area: parcel.drop.area, zone: parcel.drop.zone },
        rider,
        // Only when there is actually someone assigned — lastKnownLocation
        // can otherwise be a stray point (e.g. seeded demo data) with no
        // rider behind it, and "point" here means the rider's position.
        point: rider ? delivery.lastKnownLocation ?? null : null,
        route,
      }
      return snapshot
    })

    if (!found) throw new HttpError(404, 'no parcel with that tracking ID')
    res.json(found)
  } catch (err) {
    next(err)
  }
})

trackingRouter.get('/:parcelId', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.parcelId
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, 'not a valid parcel id')
    }

    // Scoped: an out-of-scope parcel is simply not found.
    const parcel = await ParcelModel.findById(id)
      .select('trackingId pickup drop weightKg isCod codAmount price createdAt')
      .lean<ParcelDoc | null>()
    if (!parcel) throw new HttpError(404, 'parcel not found')

    const delivery = await DeliveryModel.findOne({ parcel: parcel._id })
      .select('agent status events lastKnownLocation lastLocationAt expectedBy proofOfDelivery')
      .lean<DeliveryDoc | null>()
    if (!delivery) throw new HttpError(404, 'delivery not found')

    /**
     * The rider, as a projection. Section 7 forbids sending another user's
     * phone number, so only a name and vehicle cross the wire — never the
     * Agent document or the rider's User record.
     */
    const rider = delivery.agent
      ? await runAsSystem('tracking: rider projection', async () => {
          const agent = await AgentModel.findById(delivery.agent)
            .select('user vehicle currentLocation')
            .lean<{
              user: mongoose.Types.ObjectId
              vehicle: string
              currentLocation?: GeoPoint
            } | null>()
            .exec()
          if (!agent) return null
          const user = await UserModel.findById(agent.user)
            .select('name')
            .lean<{ name: string } | null>()
            .exec()
          return {
            name: user?.name ?? 'Unknown rider',
            vehicle: agent.vehicle,
            ...(agent.currentLocation ? { currentLocation: agent.currentLocation } : {}),
          }
        })
      : null

    /**
     * The outstanding delivery code, for the parcel's owner only.
     *
     * This project has no SMS provider, so the code cannot be texted to the
     * recipient — this screen stands in for that message, and the sender reads
     * it out. The rider is explicitly excluded: the code exists to prove the
     * rider reached the recipient, and a rider who could read it here could
     * satisfy the proof without ever knocking on a door.
     *
     * `actor.role` is the check rather than scoping, because scoping decides
     * WHICH parcels each role can see, not what each role is shown about one.
     */
    const otp =
      req.actor && req.actor.role !== 'agent'
        ? await outstandingChallenge(delivery._id)
        : null

    /**
     * The road line. Best-effort: a missing ORS key or a routing outage must
     * not blank the whole tracking screen, so the map falls back to drawing
     * just the two endpoints.
     */
    let route: Array<[number, number]> = []
    if (parcel.pickup.point && parcel.drop.point) {
      try {
        const geometry = await routeGeometry(parcel.pickup.point, parcel.drop.point)
        route = geometry.map((p) => p.coordinates)
      } catch {
        route = []
      }
    }

    res.json({
      parcel: {
        _id: parcel._id.toString(),
        trackingId: parcel.trackingId,
        pickup: {
          area: parcel.pickup.area,
          zone: parcel.pickup.zone,
          point: parcel.pickup.point ?? null,
        },
        drop: {
          area: parcel.drop.area,
          zone: parcel.drop.zone,
          recipientName: parcel.drop.contactName,
          point: parcel.drop.point ?? null,
        },
        weightKg: parcel.weightKg,
        isCod: parcel.isCod,
        codAmount: parcel.codAmount,
        total: parcel.price.total,
        createdAt: parcel.createdAt,
      },
      delivery: {
        _id: delivery._id.toString(),
        status: delivery.status,
        events: delivery.events,
        lastKnownLocation: delivery.lastKnownLocation ?? null,
        lastLocationAt: delivery.lastLocationAt ?? null,
        expectedBy: delivery.expectedBy,
        hasProofOfDelivery: Boolean(delivery.proofOfDelivery),
        proofOfDelivery: delivery.proofOfDelivery ?? null,
      },
      otp,
      rider,
      route,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /tracking/active/positions — every moving rider, for the admin board.
 *
 * Admin-only by scoping: the Delivery model's rule gives a customer their own
 * parcels and a rider their own runs, so a non-admin simply sees a short list
 * of their own rather than the whole fleet.
 */
trackingRouter.get('/active/positions', requireAuth, async (_req, res, next) => {
  try {
    const rows = await DeliveryModel.find({
      status: { $in: ['Assigned', 'PickedUp', 'InTransit'] },
    })
      .select('parcel agent status lastKnownLocation lastLocationAt')
      .limit(200)
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId
          parcel: mongoose.Types.ObjectId
          agent: mongoose.Types.ObjectId | null
          status: DeliveryStatus
          lastKnownLocation?: GeoPoint
          lastLocationAt?: Date
        }>
      >()

    const withPosition = rows.filter((r) => r.lastKnownLocation)
    if (withPosition.length === 0) {
      res.json({ riders: [] })
      return
    }

    const parcels = await ParcelModel.find({
      _id: { $in: withPosition.map((r) => r.parcel) },
    })
      .select('trackingId drop.area')
      .lean<Array<{ _id: mongoose.Types.ObjectId; trackingId: string; drop: { area: string } }>>()
    const parcelById = new Map(parcels.map((p) => [p._id.toString(), p]))

    const names = await runAsSystem('tracking: fleet names', async () => {
      const agentIds = withPosition
        .map((r) => r.agent)
        .filter((a): a is mongoose.Types.ObjectId => a !== null)
      if (agentIds.length === 0) return new Map<string, string>()
      const agents = await AgentModel.find({ _id: { $in: agentIds } })
        .select('user')
        .lean<Array<{ _id: mongoose.Types.ObjectId; user: mongoose.Types.ObjectId }>>()
        .exec()
      const users = await UserModel.find({ _id: { $in: agents.map((a) => a.user) } })
        .select('name')
        .lean<Array<{ _id: mongoose.Types.ObjectId; name: string }>>()
        .exec()
      const byUser = new Map(users.map((u) => [u._id.toString(), u.name]))
      return new Map(
        agents.map((a) => [a._id.toString(), byUser.get(a.user.toString()) ?? 'Rider']),
      )
    })

    res.json({
      riders: withPosition.flatMap((r) => {
        const parcel = parcelById.get(r.parcel.toString())
        if (!parcel || !r.lastKnownLocation) return []
        return [
          {
            deliveryId: r._id.toString(),
            parcelId: r.parcel.toString(),
            trackingId: parcel.trackingId,
            dropArea: parcel.drop.area,
            status: r.status,
            agentId: r.agent ? r.agent.toString() : null,
            agentName: r.agent ? (names.get(r.agent.toString()) ?? 'Rider') : null,
            point: r.lastKnownLocation,
            at: r.lastLocationAt ?? null,
          },
        ]
      }),
    })
  } catch (err) {
    next(err)
  }
})
