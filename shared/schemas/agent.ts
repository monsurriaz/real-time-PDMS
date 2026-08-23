import { z } from 'zod'
import { geoPoint, objectId, timestamps, zoneName } from './common'

/**
 * Agent availability. `available` is the only status the $near assignment
 * query in CLAUDE.md section 5 will match.
 */
export const agentStatusSchema = z.enum(['available', 'on_delivery', 'offline'])
export type AgentStatus = z.infer<typeof agentStatusSchema>

export const vehicleSchema = z.enum(['bicycle', 'motorcycle', 'van'])
export type Vehicle = z.infer<typeof vehicleSchema>

/**
 * A rider. One Agent document per agent-role User — the login lives on User,
 * the delivery-capacity state lives here.
 */
export const agentSchema = z.object({
  _id: objectId,
  user: objectId,
  /** Zones this agent covers. Assignment filters on membership. */
  zones: z.array(zoneName).min(1),
  vehicle: vehicleSchema,
  status: agentStatusSchema,
  /**
   * Last known position, carrying a 2dsphere index. Written at most once per
   * 30s per CLAUDE.md section 6 — the socket tick does NOT persist.
   */
  currentLocation: geoPoint.optional(),
  locationUpdatedAt: z.coerce.date().optional(),
  ...timestamps,
})
export type Agent = z.infer<typeof agentSchema>

/** Agent as shown to a customer tracking a parcel: no phone, no email. */
export const publicAgentSchema = z.object({
  _id: objectId,
  name: z.string(),
  vehicle: vehicleSchema,
  currentLocation: geoPoint.optional(),
})
export type PublicAgent = z.infer<typeof publicAgentSchema>
