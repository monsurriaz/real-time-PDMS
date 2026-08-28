import { z } from 'zod'
import { geoPoint, objectId } from './common'
import { deliveryStatusSchema } from './delivery'

/**
 * The socket contract (CLAUDE.md section 6).
 *
 *   rooms:  parcel:{id}
 *   agent   emits  location:update
 *   server  emits  location:broadcast, status:changed
 *
 * Both sides import these, so a renamed field breaks the build rather than
 * silently dropping updates at runtime.
 */

export const SOCKET_EVENTS = {
  /** Client -> server: join/leave a parcel's room. */
  join: 'parcel:join',
  leave: 'parcel:leave',
  /** Agent -> server: a GPS tick. */
  locationUpdate: 'location:update',
  /** Server -> room: a position to draw. */
  locationBroadcast: 'location:broadcast',
  /** Server -> room: the delivery moved through the lifecycle. */
  statusChanged: 'status:changed',
  /** Server -> room: a customer or rider posted into the delivery's thread (M9). */
  messageNew: 'message:new',
} as const

/** Section 6's cadence limits, shared so client and server cannot disagree. */
export const LOCATION_MIN_INTERVAL_MS = 3_000
export const LOCATION_PERSIST_INTERVAL_MS = 30_000
export const REST_POLL_INTERVAL_MS = 10_000
/** Section 6: cap retained client-side location history. */
export const MAX_LOCATION_HISTORY = 200

/** What a rider sends. `at` is the client's clock, kept for ordering only. */
export const locationUpdateSchema = z.object({
  deliveryId: objectId,
  point: geoPoint,
  /** Degrees clockwise from north, when the device reports it. */
  heading: z.number().min(0).max(360).optional(),
  /** Metres per second. */
  speed: z.number().nonnegative().max(120).optional(),
  at: z.coerce.date().optional(),
})
export type LocationUpdate = z.infer<typeof locationUpdateSchema>

/**
 * What the room receives. The server stamps `at` itself rather than trusting
 * the sender's clock, so ordering on the client is server-ordering.
 */
export const locationBroadcastSchema = z.object({
  deliveryId: objectId,
  point: geoPoint,
  heading: z.number().optional(),
  speed: z.number().optional(),
  at: z.coerce.date(),
  /** True when this tick was also written to Mongo, for the demo's benefit. */
  persisted: z.boolean(),
})
export type LocationBroadcast = z.infer<typeof locationBroadcastSchema>

export const statusChangedSchema = z.object({
  deliveryId: objectId,
  parcelId: objectId,
  status: deliveryStatusSchema,
  at: z.coerce.date(),
  agentName: z.string().nullable(),
  note: z.string().optional(),
})
export type StatusChanged = z.infer<typeof statusChangedSchema>

/** Server's reply to a join attempt — authorised, or told why not. */
export const joinResultSchema = z.object({
  parcelId: objectId,
  ok: z.boolean(),
  reason: z.string().optional(),
})
export type JoinResult = z.infer<typeof joinResultSchema>

/**
 * How the client is currently getting updates. Shown to the user verbatim:
 * section 6 requires a REST fallback, and a stale position that looks current
 * is worse than an honest "reconnecting".
 */
export const connectionModeSchema = z.enum([
  /** Socket open; updates arrive as they happen. */
  'live',
  /** Socket down; REST polling every 10s. */
  'polling',
  /** First connect not yet resolved. */
  'connecting',
  /** No socket and polling is failing too. */
  'offline',
])
export type ConnectionMode = z.infer<typeof connectionModeSchema>
