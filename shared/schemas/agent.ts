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

/**
 * Manual position setting, standing in for the GPS stream until M4.
 *
 * A discriminated union rather than four optional fields, so "neither a zone
 * nor coordinates were given" cannot be represented at all — there is no
 * runtime check to forget.
 */
export const setAgentLocationInputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('zone'), zone: zoneName }),
  z.object({
    mode: z.literal('coords'),
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
  }),
])
export type SetAgentLocationInput = z.infer<typeof setAgentLocationInputSchema>

/**
 * The rider's own shift toggle — available or offline, nothing else.
 *
 * `on_delivery` is deliberately absent: the system sets it when work is picked
 * up and clears it when the run ends, so letting a rider claim it by hand
 * would let them duck assignment while appearing busy.
 */
export const setAgentStatusInputSchema = z.object({
  status: z.enum(['available', 'offline']),
})
export type SetAgentStatusInput = z.infer<typeof setAgentStatusInputSchema>

/** GET /agents/me — the rider's own record, behind the shift controls. */
export const agentSelfSchema = z.object({
  _id: objectId,
  status: agentStatusSchema,
  vehicle: vehicleSchema,
  zones: z.array(zoneName),
  currentLocation: geoPoint.optional(),
  locationUpdatedAt: z.coerce.date().optional(),
  /** Deliveries they are currently holding, so the toggle is an informed one. */
  activeCount: z.number().int().nonnegative(),
})
export type AgentSelf = z.infer<typeof agentSelfSchema>
