import { z } from 'zod'
import { objectId, taka, trackingId, zoneName } from './common'
import { deliveryStatusSchema } from './delivery'

/**
 * The admin analytics screen (CLAUDE.md M6).
 *
 * Everything here is DERIVED — counted from deliveries, parcels and payments at
 * read time. Nothing is stored as a running total, for the same reason the COD
 * table is derived: a number nobody can re-compute is a number nobody can check.
 */

/** One headline figure. `delta` is absent when there is nothing to compare to. */
export const statCardSchema = z.object({
  value: z.number(),
  /** Change against the previous window of the same length, as a percentage. */
  deltaPct: z.number().nullable(),
  /** What the previous window held, so the delta can be explained. */
  previous: z.number().nullable(),
})
export type StatCard = z.infer<typeof statCardSchema>

/**
 * A parcel past its promised time and still moving.
 *
 * `minutesLate` rather than a timestamp difference computed on the client: the
 * server owns the clock, and two machines disagreeing about "late" during a demo
 * is exactly the kind of thing nobody can debug live.
 */
export const delayedParcelSchema = z.object({
  deliveryId: objectId,
  parcelId: objectId,
  trackingId,
  status: deliveryStatusSchema,
  dropZone: zoneName,
  agentName: z.string().nullable(),
  expectedBy: z.coerce.date(),
  minutesLate: z.number().int().nonnegative(),
  isCod: z.boolean(),
  codAmount: taka,
})
export type DelayedParcel = z.infer<typeof delayedParcelSchema>

/**
 * One zone's row in the performance chart.
 *
 * `completed` and `open` are the two segments the chart draws; the rest are the
 * numbers printed beside it. The chart is single-hue on purpose — see the
 * client component for why the lifecycle ramp cannot be used as a categorical
 * set here.
 */
export const zonePerformanceSchema = z.object({
  zone: zoneName,
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  /** Still moving: Booked, Assigned, PickedUp or InTransit. */
  open: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  delayed: z.number().int().nonnegative(),
  /** Delivered as a share of everything that reached a terminal state. */
  successRate: z.number().min(0).max(1).nullable(),
  /** Booking to delivery, in minutes, averaged over delivered parcels. */
  medianMinutes: z.number().nonnegative().nullable(),
  revenue: taka,
})
export type ZonePerformance = z.infer<typeof zonePerformanceSchema>

export const analyticsOverviewSchema = z.object({
  /** Every delivery ever booked. */
  totalDeliveries: statCardSchema,
  /** Booked, Assigned, PickedUp or InTransit right now. */
  activeDeliveries: statCardSchema,
  /** Riders on shift — available or carrying something. */
  activeAgents: statCardSchema,
  /** Fees on delivered parcels. The money actually earned. */
  revenue: statCardSchema,
  delayed: z.object({
    count: z.number().int().nonnegative(),
    parcels: z.array(delayedParcelSchema),
  }),
  zones: z.array(zonePerformanceSchema),
  /** Cash riders are holding, carried over from the COD ledger. */
  codOutstanding: taka,
  /** The window every delta is measured against, in hours. */
  comparisonWindowHours: z.number().int().positive(),
  generatedAt: z.coerce.date(),
})
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>
