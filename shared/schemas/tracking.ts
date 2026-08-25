import { z } from 'zod'
import { vehicleSchema } from './agent'
import { geoPoint, trackingId, zoneName } from './common'
import { deliveryStatusSchema } from './delivery'

/**
 * GET /track/:trackingId — the unauthenticated lookup. Deliberately smaller
 * than the authenticated customer snapshot (useLiveTracking's
 * TrackingSnapshot): no recipient contact name, no weight or price, no
 * delivery code, and no event notes — a stranger with a tracking ID gets
 * enough to answer "where is it and is it moving", not the parcel's contents
 * or who is receiving it. CLAUDE.md section 7's spirit applied to a route
 * that has no session to scope in the first place.
 */
export const publicTrackingSnapshotSchema = z.object({
  trackingId: trackingId,
  status: deliveryStatusSchema,
  pickup: z.object({ area: z.string(), zone: zoneName }),
  drop: z.object({ area: z.string(), zone: zoneName }),
  rider: z.object({ name: z.string(), vehicle: vehicleSchema }).nullable(),
  point: geoPoint.nullable(),
  route: z.array(z.tuple([z.number(), z.number()])),
})
export type PublicTrackingSnapshot = z.infer<typeof publicTrackingSnapshotSchema>
