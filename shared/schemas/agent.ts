import { z } from 'zod'
import { geoPoint, objectId, phone, timestamps, zoneName } from './common'

/**
 * Agent availability. `available` is the only status the $near assignment
 * query in CLAUDE.md section 5 will match.
 */
export const agentStatusSchema = z.enum(['available', 'on_delivery', 'offline'])
export type AgentStatus = z.infer<typeof agentStatusSchema>

export const vehicleSchema = z.enum(['bicycle', 'motorcycle', 'van'])
export type Vehicle = z.infer<typeof vehicleSchema>

/**
 * A self-registered rider starts `pending` and cannot be assigned work —
 * enforced in services/assignment.ts's own filter, not by convention — until
 * an admin approves them. `rejected` is terminal; there is no un-reject in
 * this build (CLAUDE.md's "no admin unassign" reasoning applies the same way
 * here: reinstating a rejected application is a decision to take on purpose,
 * not part of a status enum).
 */
export const agentApprovalStatusSchema = z.enum(['pending', 'approved', 'rejected'])
export type AgentApprovalStatus = z.infer<typeof agentApprovalStatusSchema>

/**
 * NID or driving-licence number. Loose on purpose — this project has no
 * document-verification integration, so the field records what the
 * applicant typed rather than validating a specific national ID format.
 */
export const agentNidSchema = z
  .string()
  .trim()
  .min(6, 'must be at least 6 characters')
  .max(30)
  .regex(/^[A-Za-z0-9-]+$/, 'letters, numbers and hyphens only')

/**
 * Shows the first 4 and last 2 characters, masking the rest — the shape
 * v3's approval-queue mockup draws ("1990••••••34"). An admin needs enough
 * of the number to eyeball it against a physical document without this
 * screen becoming a second place the full number is exposed.
 */
export const maskNid = (nid: string): string =>
  nid.length <= 6 ? '•'.repeat(nid.length) : `${nid.slice(0, 4)}${'•'.repeat(nid.length - 6)}${nid.slice(-2)}`

/**
 * One approve/reject decision, appended to `approvalHistory`. Same shape as
 * Delivery's `events[]` — append-only, actor named, never edited — so a
 * decision naming which admin made it survives even if the status changes
 * again later.
 */
export const agentApprovalEventSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  at: z.coerce.date(),
  by: objectId,
})
export type AgentApprovalEvent = z.infer<typeof agentApprovalEventSchema>

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
  approvalStatus: agentApprovalStatusSchema,
  nid: agentNidSchema,
  approvalHistory: z.array(agentApprovalEventSchema).default([]),
  /**
   * Last known position, carrying a 2dsphere index. Written at most once per
   * 30s per CLAUDE.md section 6 — the socket tick does NOT persist.
   */
  currentLocation: geoPoint.optional(),
  locationUpdatedAt: z.coerce.date().optional(),
  ...timestamps,
})
export type Agent = z.infer<typeof agentSchema>

/**
 * What a signup submits for the rider path, beyond the fields every account
 * shares (name/email/phone/password — see registerInputSchema in user.ts).
 * `zone` is singular — one "preferred zone" at signup — while `Agent.zones`
 * is a list; registration seeds it with that one zone, and the profile's
 * rider-details tab can add more later.
 */
export const agentApplicationFieldsSchema = z.object({
  vehicle: vehicleSchema,
  zone: zoneName,
  nid: agentNidSchema,
})
export type AgentApplicationFields = z.infer<typeof agentApplicationFieldsSchema>

/** What the agent-details tab on /agent/profile may change. NID is not here — it is not re-editable once submitted. */
export const updateAgentDetailsInputSchema = z.object({
  vehicle: vehicleSchema,
  zones: z.array(zoneName).min(1),
})
export type UpdateAgentDetailsInput = z.infer<typeof updateAgentDetailsInputSchema>

/**
 * M9: the rider's ACCOUNT status — User.status (M6.9), a moderation
 * decision, kept deliberately separate from `approvalStatus` above (an
 * application decision) rather than folded into a third value of it —
 * see routes/agents.ts's own note for why.
 *
 * Mirrors userStatusSchema's two values without importing it from user.ts:
 * user.ts already imports FROM this file (agentApplicationFieldsSchema), so
 * the reverse import would be a circular module dependency that breaks at
 * evaluation time (this schema would see `undefined` where user.ts's export
 * should be), not merely a lint complaint. Two literal strings duplicated
 * once is the cheaper price.
 */
export const agentAccountStatusSchema = z.enum(['active', 'suspended'])
export type AgentAccountStatus = z.infer<typeof agentAccountStatusSchema>

/**
 * One row of the admin's roster / approval queue. NID arrives already
 * masked — see maskNid — so the wire shape itself cannot leak the full
 * number regardless of what the screen does with it.
 */
export const agentRosterItemSchema = z.object({
  _id: objectId,
  userId: objectId,
  name: z.string(),
  phone: phone,
  email: z.string().email(),
  vehicle: vehicleSchema,
  zones: z.array(zoneName),
  status: agentStatusSchema,
  approvalStatus: agentApprovalStatusSchema,
  /** M9: whether this rider's ACCOUNT (not their application) is suspended. */
  accountStatus: agentAccountStatusSchema,
  maskedNid: z.string(),
  appliedAt: z.coerce.date(),
})
export type AgentRosterItem = z.infer<typeof agentRosterItemSchema>

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

/**
 * GET /agents/me — the rider's own record, behind the shift controls AND the
 * profile's rider-details tab. `nid` is shown here unmasked — it is the
 * rider reading their own record, not an admin's list — and `approvalStatus`
 * is what /agent/pending and the RequireRole approval gate both key off.
 */
export const agentSelfSchema = z.object({
  _id: objectId,
  status: agentStatusSchema,
  approvalStatus: agentApprovalStatusSchema,
  vehicle: vehicleSchema,
  zones: z.array(zoneName),
  nid: agentNidSchema,
  currentLocation: geoPoint.optional(),
  locationUpdatedAt: z.coerce.date().optional(),
  /** Deliveries they are currently holding, so the toggle is an informed one. */
  activeCount: z.number().int().nonnegative(),
})
export type AgentSelf = z.infer<typeof agentSelfSchema>
