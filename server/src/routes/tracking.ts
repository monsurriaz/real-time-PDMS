import { Router } from 'express'
import mongoose from 'mongoose'
import type { DeliveryEvent, DeliveryStatus, GeoPoint, ZoneName } from '@pdms/shared'
import { runAsSystem } from '../lib/context'
import { routeGeometry } from '../lib/routing'
import { AgentModel } from '../models/Agent'
import { DeliveryModel } from '../models/Delivery'
import { ParcelModel } from '../models/Parcel'
import { UserModel } from '../models/User'
import { requireAuth } from '../middleware/auth'
import { HttpError } from '../middleware/httpError'

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
      },
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
