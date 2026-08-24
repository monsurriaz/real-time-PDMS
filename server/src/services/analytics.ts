import mongoose from 'mongoose'
import {
  zoneName,
  type AnalyticsOverview,
  type DelayedParcel,
  type DeliveryStatus,
  type StatCard,
  type ZonePerformance,
  type ZoneName,
} from '@pdms/shared'
import { runAsSystem } from '../lib/context'
import { AgentModel } from '../models/Agent'
import { DeliveryModel } from '../models/Delivery'
import { ParcelModel } from '../models/Parcel'
import { PaymentModel } from '../models/Payment'
import { UserModel } from '../models/User'

/**
 * The admin analytics figures.
 *
 * Deliberately NOT an aggregation pipeline. CLAUDE.md section 7 puts role
 * scoping in query middleware, and `$lookup`/`$match` bypass that middleware
 * entirely — the roleScope plugin says so in its own closing comment. So this
 * reads through `find()` inside `runAsSystem`, where "unscoped" is stated rather
 * than accidental, and does the arithmetic in JavaScript.
 *
 * That is affordable because the numbers are small: the whole delivery
 * collection for a course demo is tens of documents, and the route is
 * admin-only. If it ever stopped being affordable, the fix is a pipeline behind
 * an explicit `$match`, not scoping that silently does nothing.
 */

/** Statuses that mean "still moving". */
const OPEN: readonly DeliveryStatus[] = ['Booked', 'Assigned', 'PickedUp', 'InTransit']
const isOpen = (s: DeliveryStatus): boolean => OPEN.includes(s)

/**
 * Deltas compare the last 24 hours against the 24 before it.
 *
 * A window has to be chosen and CLAUDE.md does not choose one. A day is the
 * shortest window a seven-day demo can show a change over, and the client is
 * told the number so the screen can say "vs yesterday" rather than implying a
 * comparison it never made.
 */
export const COMPARISON_WINDOW_HOURS = 24

interface DeliveryRow {
  _id: mongoose.Types.ObjectId
  parcel: mongoose.Types.ObjectId
  agent: mongoose.Types.ObjectId | null
  status: DeliveryStatus
  expectedBy: Date | null
  deliveredAt: Date | null
  createdAt: Date
}

interface ParcelRow {
  _id: mongoose.Types.ObjectId
  trackingId: string
  drop: { zone: ZoneName }
  pickup: { zone: ZoneName }
  price: { total: number }
  isCod: boolean
  codAmount: number
  createdAt: Date
}

/** value + change against the previous window, as the design system's stat card wants. */
const card = (current: number, previous: number | null): StatCard => ({
  value: current,
  previous,
  deltaPct:
    previous === null || previous === 0
      ? null
      : Math.round(((current - previous) / previous) * 1000) / 10,
})

export const overview = async (): Promise<AnalyticsOverview> => {
  const now = Date.now()
  const windowMs = COMPARISON_WINDOW_HOURS * 3_600_000
  const since = new Date(now - windowMs)
  const previousSince = new Date(now - windowMs * 2)

  const { deliveries, parcels, agents, riderNames, codOutstanding } = await runAsSystem(
    'analytics: overview',
    async () => {
      const deliveryRows = await DeliveryModel.find()
        .select('parcel agent status expectedBy deliveredAt createdAt')
        .limit(2000)
        .lean<DeliveryRow[]>()
        .exec()

      const parcelRows = await ParcelModel.find({
        _id: { $in: deliveryRows.map((d) => d.parcel) },
      })
        .select('trackingId drop.zone pickup.zone price.total isCod codAmount createdAt')
        .lean<ParcelRow[]>()
        .exec()

      const agentRows = await AgentModel.find()
        .select('user status')
        .lean<
          Array<{
            _id: mongoose.Types.ObjectId
            user: mongoose.Types.ObjectId
            status: 'available' | 'on_delivery' | 'offline'
          }>
        >()
        .exec()

      const users = await UserModel.find({ _id: { $in: agentRows.map((a) => a.user) } })
        .select('name')
        .lean<Array<{ _id: mongoose.Types.ObjectId; name: string }>>()
        .exec()
      const nameByUser = new Map(users.map((u) => [u._id.toString(), u.name]))

      const collected = await PaymentModel.find({ method: 'cod', status: 'collected' })
        .select('amount')
        .lean<Array<{ amount: number }>>()
        .exec()

      return {
        deliveries: deliveryRows,
        parcels: parcelRows,
        agents: agentRows,
        riderNames: new Map(
          agentRows.map((a) => [
            a._id.toString(),
            nameByUser.get(a.user.toString()) ?? 'Rider',
          ]),
        ),
        codOutstanding: collected.reduce((sum, p) => sum + p.amount, 0),
      }
    },
  )

  const parcelById = new Map(parcels.map((p) => [p._id.toString(), p]))

  // ---- headline figures ----
  /**
   * "When was this booked" is a fact about the PARCEL, not about the delivery
   * record that tracks it. They are normally within milliseconds of each other,
   * but the seed backdates parcels to give the board a plausible spread — so
   * reading the delivery's own createdAt would report every demo parcel as
   * booked in the last minute and make every delta meaningless.
   */
  const bookedAt = (d: DeliveryRow): Date =>
    parcelById.get(d.parcel.toString())?.createdAt ?? d.createdAt

  const inWindow = (d: DeliveryRow, from: Date, to: Date): boolean => {
    const at = bookedAt(d)
    return at >= from && at < to
  }
  const bookedRecently = deliveries.filter((d) => inWindow(d, since, new Date(now)))

  const active = deliveries.filter((d) => isOpen(d.status))
  /**
   * The previous window's "active" is a reconstruction, not a measurement — we
   * do not keep history — so it counts deliveries that had been booked but not
   * yet finished at that moment. Close enough to be useful, and the delta is
   * labelled as a comparison against the previous day rather than as truth.
   */
  const activePreviously = deliveries.filter(
    (d) => bookedAt(d) < since && (d.deliveredAt === null || d.deliveredAt >= since),
  ).length

  const revenueOf = (rows: DeliveryRow[]): number =>
    rows.reduce((sum, d) => {
      if (d.status !== 'Delivered') return sum
      return sum + (parcelById.get(d.parcel.toString())?.price.total ?? 0)
    }, 0)

  const deliveredRecently = deliveries.filter(
    (d) => d.deliveredAt !== null && d.deliveredAt >= since,
  )
  const deliveredBefore = deliveries.filter(
    (d) => d.deliveredAt !== null && d.deliveredAt >= previousSince && d.deliveredAt < since,
  )

  const onShift = agents.filter((a) => a.status !== 'offline').length

  // ---- delayed ----
  const delayedRows = deliveries
    .filter((d) => d.expectedBy !== null && d.expectedBy.getTime() < now && isOpen(d.status))
    .sort((a, b) => (a.expectedBy?.getTime() ?? 0) - (b.expectedBy?.getTime() ?? 0))

  const delayedParcels: DelayedParcel[] = delayedRows.flatMap((d) => {
    const parcel = parcelById.get(d.parcel.toString())
    if (!parcel || !d.expectedBy) return []
    return [
      {
        deliveryId: d._id.toString(),
        parcelId: parcel._id.toString(),
        trackingId: parcel.trackingId,
        status: d.status,
        dropZone: parcel.drop.zone,
        agentName: d.agent ? (riderNames.get(d.agent.toString()) ?? null) : null,
        expectedBy: d.expectedBy,
        minutesLate: Math.floor((now - d.expectedBy.getTime()) / 60_000),
        isCod: parcel.isCod,
        codAmount: parcel.codAmount,
      },
    ]
  })

  // ---- per zone ----
  /**
   * Keyed on the DROP zone: zone performance is about where parcels are being
   * taken, which is what an operations lead is looking at when they ask why one
   * area runs late. (Pricing keys off the PICKUP zone — a different question,
   * recorded as such in DEFERRED.)
   */
  const blank = (zone: ZoneName): ZonePerformance => ({
    zone,
    total: 0,
    completed: 0,
    open: 0,
    failed: 0,
    cancelled: 0,
    delayed: 0,
    successRate: null,
    medianMinutes: null,
    revenue: 0,
  })

  const byZone = new Map<ZoneName, ZonePerformance>(
    zoneName.options.map((z) => [z, blank(z)]),
  )
  const durations = new Map<ZoneName, number[]>()
  const delayedIds = new Set(delayedRows.map((d) => d._id.toString()))

  for (const d of deliveries) {
    const parcel = parcelById.get(d.parcel.toString())
    if (!parcel) continue
    const row = byZone.get(parcel.drop.zone)
    if (!row) continue

    row.total += 1
    if (d.status === 'Delivered') {
      row.completed += 1
      row.revenue += parcel.price.total
      if (d.deliveredAt) {
        const minutes = (d.deliveredAt.getTime() - parcel.createdAt.getTime()) / 60_000
        if (minutes >= 0) {
          const list = durations.get(parcel.drop.zone) ?? []
          list.push(minutes)
          durations.set(parcel.drop.zone, list)
        }
      }
    } else if (d.status === 'Failed') row.failed += 1
    else if (d.status === 'Cancelled') row.cancelled += 1
    else row.open += 1

    if (delayedIds.has(d._id.toString())) row.delayed += 1
  }

  for (const [zone, row] of byZone) {
    const finished = row.completed + row.failed
    row.successRate = finished > 0 ? row.completed / finished : null

    /**
     * Median, not mean. One parcel that sat in a depot overnight drags a mean
     * far enough to make a healthy zone look broken, and with a handful of
     * deliveries per zone that happens constantly.
     */
    const list = (durations.get(zone) ?? []).sort((a, b) => a - b)
    if (list.length > 0) {
      const mid = Math.floor(list.length / 2)
      const median =
        list.length % 2 === 0 ? ((list[mid - 1] ?? 0) + (list[mid] ?? 0)) / 2 : (list[mid] ?? 0)
      row.medianMinutes = Math.round(median)
    }
  }

  return {
    /**
     * Total is cumulative, so its "previous" is the same total a day ago —
     * everything except what was booked since. The delta then reads as growth
     * rather than as a count that inexplicably never falls.
     */
    totalDeliveries: card(deliveries.length, deliveries.length - bookedRecently.length),
    activeDeliveries: card(active.length, activePreviously),
    activeAgents: card(onShift, null),
    revenue: card(revenueOf(deliveredRecently), revenueOf(deliveredBefore)),
    delayed: { count: delayedParcels.length, parcels: delayedParcels.slice(0, 25) },
    zones: [...byZone.values()].sort((a, b) => b.total - a.total || a.zone.localeCompare(b.zone)),
    codOutstanding,
    comparisonWindowHours: COMPARISON_WINDOW_HOURS,
    generatedAt: new Date(now),
  }
}
