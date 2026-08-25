import { Router } from 'express'
import mongoose from 'mongoose'
import type { DeliveryStatus, Notification } from '@pdms/shared'
import { DeliveryModel } from '../models/Delivery'
import { ParcelModel } from '../models/Parcel'
import { requireAuth } from '../middleware/auth'
import { unauthorized } from '../middleware/httpError'

export const notificationsRouter = Router()

/** Statuses a delivery can still be late for — matches analytics.ts's own. */
const OPEN: readonly DeliveryStatus[] = ['Booked', 'Assigned', 'PickedUp', 'InTransit']

const STATUS_PHRASE: Record<DeliveryStatus, string> = {
  Booked: 'booked',
  Assigned: 'assigned to a rider',
  PickedUp: 'picked up',
  InTransit: 'in transit',
  Delivered: 'delivered',
  Cancelled: 'cancelled',
  Failed: 'could not be delivered',
}

interface DeliveryLean {
  _id: mongoose.Types.ObjectId
  parcel: mongoose.Types.ObjectId
  status: DeliveryStatus
  events: Array<{ status: DeliveryStatus; at: Date }>
  expectedBy: Date | null
}

interface ParcelLean {
  _id: mongoose.Types.ObjectId
  trackingId: string
  drop: { area: string }
}

/**
 * GET /notifications — the header bell.
 *
 * Neither query below runs as system: both are the caller's own
 * `DeliveryModel.find`, so the SAME roleScope rule every other route gets
 * (customer -> their own parcels' deliveries, agent -> their own
 * assignments, admin -> everything) applies here with no special-casing.
 * There is no unscoped read in this handler.
 */
notificationsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()

    // ---- recent status changes, on whatever this actor can see ----
    const recent = await DeliveryModel.find({})
      .select('parcel status events expectedBy')
      .sort({ updatedAt: -1 })
      .limit(8)
      .lean<DeliveryLean[]>()

    const parcelIds = recent.map((d) => d.parcel)

    // ---- overdue, admin only — same definition analytics.ts's dashboard uses ----
    const now = Date.now()
    const overdue =
      actor.role === 'admin'
        ? await DeliveryModel.find({
            expectedBy: { $lt: new Date(now) },
            status: { $in: OPEN },
          })
            .select('parcel status expectedBy')
            .sort({ expectedBy: 1 })
            .limit(8)
            .lean<DeliveryLean[]>()
        : []

    const allParcelIds = [...parcelIds, ...overdue.map((d) => d.parcel)]
    const parcels =
      allParcelIds.length > 0
        ? await ParcelModel.find({ _id: { $in: allParcelIds } })
            .select('trackingId drop.area')
            .lean<ParcelLean[]>()
        : []
    const parcelById = new Map(parcels.map((p) => [p._id.toString(), p]))

    const statusNotifications: Notification[] = recent.flatMap((d) => {
      const parcel = parcelById.get(d.parcel.toString())
      const lastEvent = d.events.at(-1)
      if (!parcel || !lastEvent) return []
      return [
        {
          id: `status:${d._id.toString()}:${lastEvent.at.getTime()}`,
          kind: 'status' as const,
          status: d.status,
          title: `${parcel.trackingId} ${STATUS_PHRASE[d.status] ?? d.status}`,
          subtitle: parcel.drop.area,
          at: lastEvent.at,
        },
      ]
    })

    const overdueNotifications: Notification[] = overdue.flatMap((d) => {
      const parcel = parcelById.get(d.parcel.toString())
      if (!parcel || !d.expectedBy) return []
      const minutesLate = Math.max(0, Math.floor((now - d.expectedBy.getTime()) / 60_000))
      const h = Math.floor(minutesLate / 60)
      const m = minutesLate % 60
      return [
        {
          id: `overdue:${d._id.toString()}`,
          kind: 'overdue' as const,
          status: d.status,
          title: `${parcel.trackingId} is overdue`,
          subtitle: h > 0 ? `${h}h ${m}m past ETA` : `${m}m past ETA`,
          at: d.expectedBy,
        },
      ]
    })

    const notifications = [...overdueNotifications, ...statusNotifications]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 12)

    res.json({ notifications })
  } catch (err) {
    next(err)
  }
})
