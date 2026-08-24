import { z } from 'zod'
import { geoPoint, objectId, role, timestamps } from './common'

/**
 * The delivery lifecycle, exactly as drawn in CLAUDE.md section 5:
 *
 *   Booked -> Assigned -> PickedUp -> InTransit -> Delivered   (terminal)
 *                     \-> Cancelled (before PickedUp only)
 *                     \-> Failed    (from InTransit only)
 *
 * The legal-transition MAP is deliberately not in /shared. CLAUDE.md rule 3
 * says the client never decides what transition is legal, so the map lives
 * server-side only, in server/src/services/lifecycle.ts. This enum is shared
 * because both sides need to *name* a status; only the server may judge one.
 */
export const deliveryStatusSchema = z.enum([
  'Booked',
  'Assigned',
  'PickedUp',
  'InTransit',
  'Delivered',
  'Cancelled',
  'Failed',
])
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>

/** Statuses no transition may leave. */
export const TERMINAL_STATUSES = [
  'Delivered',
  'Cancelled',
  'Failed',
] as const satisfies readonly DeliveryStatus[]

/**
 * One entry in the append-only log. Every transition appends one, with actor,
 * timestamp and coordinates (CLAUDE.md section 5).
 */
export const deliveryEventSchema = z.object({
  status: deliveryStatusSchema,
  at: z.coerce.date(),
  /** Who caused it. Null actor means the system (e.g. auto-assignment). */
  actor: objectId.nullable(),
  actorRole: role.nullable(),
  /** Where the actor was, when known — riders have GPS, admins do not. */
  point: geoPoint.optional(),
  note: z.string().max(300).optional(),
})
export type DeliveryEvent = z.infer<typeof deliveryEventSchema>

export const podMethodSchema = z.enum(['photo', 'otp', 'signature'])
export type PodMethod = z.infer<typeof podMethodSchema>

/**
 * Proof of delivery. CLAUDE.md section 5: reaching Delivered requires this to
 * already be on the record, so advanceStatus() reads it rather than
 * accepting it alongside the transition.
 */
export const proofOfDeliverySchema = z.object({
  method: podMethodSchema,
  /** Cloudinary secure URL for photo proof. */
  photoUrl: z.string().url().optional(),
  /** Hash only — never store a reusable OTP in plaintext. */
  otpVerifiedAt: z.coerce.date().optional(),
  receivedBy: z.string().min(2).max(80),
  capturedAt: z.coerce.date(),
})
export type ProofOfDelivery = z.infer<typeof proofOfDeliverySchema>

/**
 * The lifecycle record for one parcel. Assignment and status live here; the
 * shipment's own facts live on Parcel.
 */
export const deliverySchema = z.object({
  _id: objectId,
  parcel: objectId,
  /** Null until first assignment; reassignable before PickedUp only. */
  agent: objectId.nullable(),
  status: deliveryStatusSchema,
  events: z.array(deliveryEventSchema),

  assignedAt: z.coerce.date().nullable(),
  pickedUpAt: z.coerce.date().nullable(),
  deliveredAt: z.coerce.date().nullable(),

  proofOfDelivery: proofOfDeliverySchema.optional(),
  failureReason: z.string().max(300).optional(),

  /**
   * Sparse trail of persisted positions. Section 6 caps writes at one per
   * 30s — the 3s socket tick is broadcast, not stored.
   */
  lastKnownLocation: geoPoint.optional(),
  lastLocationAt: z.coerce.date().optional(),

  /** Set by the analytics pass in M6; drives the "delayed" alert. */
  expectedBy: z.coerce.date().nullable(),
  ...timestamps,
})
export type Delivery = z.infer<typeof deliverySchema>

/**
 * What an agent or admin submits to move a delivery forward. The target
 * status is a request, not a decision — the server validates it against the
 * transition map and rejects anything illegal.
 */
export const advanceStatusInputSchema = z.object({
  to: deliveryStatusSchema,
  point: geoPoint.optional(),
  note: z.string().max(300).optional(),
})
export type AdvanceStatusInput = z.infer<typeof advanceStatusInputSchema>

/**
 * POST /deliveries/:id/assign. An absent agentId means "pick the nearest
 * available rider"; supplying one is the admin override from section 5.
 */
export const assignInputSchema = z.object({
  agentId: objectId.optional(),
})
export type AssignInput = z.infer<typeof assignInputSchema>

/**
 * Proof of delivery capture, M3 scope: enough to satisfy the precondition
 * that section 5 puts on Delivered, without the photo upload and OTP flow
 * that belong to M5. A typed recipient name is a real signature record, not
 * a placeholder that pretends to be one.
 */
export const recordPodInputSchema = z.object({
  receivedBy: z.string().min(2).max(80),
  note: z.string().max(300).optional(),
})
export type RecordPodInput = z.infer<typeof recordPodInputSchema>

/** A delivery as it appears on the agent's run list or the admin's board. */
export const deliveryListItemSchema = z.object({
  _id: objectId,
  parcelId: objectId,
  trackingId: z.string(),
  status: deliveryStatusSchema,
  pickupArea: z.string(),
  pickupZone: z.string(),
  dropArea: z.string(),
  dropZone: z.string(),
  recipientName: z.string(),
  weightKg: z.number(),
  total: z.number(),
  isCod: z.boolean(),
  codAmount: z.number(),
  hasProofOfDelivery: z.boolean(),
  /** Null while unassigned. */
  agentName: z.string().nullable(),
  agentId: objectId.nullable(),
  /** What this viewer is allowed to do next, per the server's own map. */
  allowedTransitions: z.array(deliveryStatusSchema),
  expectedBy: z.coerce.date().nullable(),
  isOverdue: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type DeliveryListItem = z.infer<typeof deliveryListItemSchema>
