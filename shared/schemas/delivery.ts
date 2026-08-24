import { z } from 'zod'
import { geoPoint, objectId, role, timestamps } from './common'
import { paymentStatusSchema } from './payment'

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
 * A Cloudinary delivery URL, and nothing else.
 *
 * The photo is uploaded straight from the rider's phone with the unsigned
 * preset (CLAUDE.md section 2), so the URL arrives from the client and cannot
 * be trusted on shape alone. This narrows it to Cloudinary's delivery host;
 * the server additionally checks it names OUR cloud, which is the part only
 * the server knows.
 */
export const cloudinaryUrl = z
  .string()
  .url()
  .max(500)
  .refine(
    (u) => u.startsWith('https://res.cloudinary.com/'),
    'must be an https Cloudinary delivery URL',
  )

/**
 * Proof of delivery. CLAUDE.md section 5: reaching Delivered requires this to
 * already be on the record, so advanceStatus() reads it rather than
 * accepting it alongside the transition.
 *
 * Three live methods since M5, and each one carries its own evidence — which
 * is why the per-method refinement below exists rather than a shape where
 * every field is optional and any combination validates. A record claiming
 * `method: 'photo'` with no photoUrl would satisfy the Delivered precondition
 * while proving nothing.
 */
export const proofOfDeliverySchema = z
  .object({
    method: podMethodSchema,
    /** Cloudinary secure URL for photo proof. The binary is never stored. */
    photoUrl: cloudinaryUrl.optional(),
    /**
     * When the server matched the code the recipient read out. A timestamp
     * only: the proof record never keeps the code itself, so it cannot be
     * replayed from the record.
     */
    otpVerifiedAt: z.coerce.date().optional(),
    /**
     * Who took it. Required for a signature — that IS the signature — and
     * optional for photo and OTP, where the evidence is the photo or the code
     * and a typed name would be an unverified extra claim.
     */
    receivedBy: z.string().min(2).max(80).optional(),
    capturedAt: z.coerce.date(),
  })
  .superRefine((pod, ctx) => {
    const missing =
      pod.method === 'photo'
        ? !pod.photoUrl && 'photoUrl'
        : pod.method === 'otp'
          ? !pod.otpVerifiedAt && 'otpVerifiedAt'
          : !pod.receivedBy && 'receivedBy'
    if (missing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [missing],
        message: `${missing} is required for ${pod.method} proof`,
      })
    }
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
 * What the rider submits to record proof. One arm per method, discriminated on
 * `method`, so the payload cannot be half-filled: a photo submission without a
 * URL and an OTP submission without a code both fail to parse rather than
 * arriving as an empty proof the server has to second-guess.
 *
 * Note what the OTP arm does NOT contain: any judgement about whether the code
 * is right. The client sends the digits the recipient read out and the server
 * decides, because a client that could validate the code could also skip it.
 */
export const recordPodInputSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('signature'),
    receivedBy: z.string().min(2).max(80),
    note: z.string().max(300).optional(),
  }),
  z.object({
    method: z.literal('photo'),
    photoUrl: cloudinaryUrl,
    /** Optional here: the photo is the evidence. */
    receivedBy: z.string().min(2).max(80).optional(),
    note: z.string().max(300).optional(),
  }),
  z.object({
    method: z.literal('otp'),
    /** Exactly what the recipient read out. Verified server-side. */
    code: z.string().regex(/^\d{6}$/, 'the code is six digits'),
    receivedBy: z.string().min(2).max(80).optional(),
    note: z.string().max(300).optional(),
  }),
])
export type RecordPodInput = z.infer<typeof recordPodInputSchema>

/** Length of an issued delivery code, shared so both sides agree. */
export const POD_OTP_LENGTH = 6
/** How long a code stays usable. Short: it is read out at the door. */
export const POD_OTP_TTL_MS = 10 * 60_000
/** Wrong guesses allowed before the code is burned. */
export const POD_OTP_MAX_ATTEMPTS = 5

/**
 * The rider's view of issuing a code: when it was sent and when it dies.
 *
 * Deliberately NOT the code. The rider is the party the code is meant to
 * check, so returning it here would make OTP proof worth no more than the
 * rider's word.
 */
export const otpIssuedSchema = z.object({
  issuedAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  attemptsRemaining: z.number().int().nonnegative(),
})
export type OtpIssued = z.infer<typeof otpIssuedSchema>

/**
 * The code as the parcel's owner sees it on the tracking screen.
 *
 * There is no SMS provider in this project's stack, so the tracking screen
 * stands in for the text message to the recipient: the sender reads it out
 * over the phone. It reaches the customer and the admin, never the rider.
 */
export const otpChallengeSchema = z.object({
  code: z.string(),
  expiresAt: z.coerce.date(),
})
export type OtpChallenge = z.infer<typeof otpChallengeSchema>

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
  /**
   * Where this parcel's cash stands, when it is a COD parcel: null for a
   * prepaid one. The rider's screen needs it to stop showing "collect" for
   * money already handed over, and the admin board to spot uncollected cash.
   */
  codStatus: paymentStatusSchema.nullable(),
  hasProofOfDelivery: z.boolean(),
  /** Which of the three methods was used, for the finished list. */
  podMethod: podMethodSchema.nullable(),
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
