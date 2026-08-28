import { z } from 'zod'
import { objectId, timestamps } from './common'

/**
 * Customer <-> rider chat, one thread per delivery (M9).
 *
 * The sender always has an account; the recipient (the drop contact) never
 * does — they are reached by phone instead (see deliveries.ts's
 * `recipientPhone`), not through this feature. Windowed to CLAUDE.md section
 * 5's PickedUp-to-terminal span: opens the moment a rider has the parcel in
 * hand, closes the moment the delivery reaches Delivered, Cancelled or
 * Failed. Closed means read-only history, never deleted, and the window is
 * enforced server-side (routes/messages.ts) — a stale client still showing
 * the input must not be enough to post into a closed thread.
 *
 * Reuses the parcel:{id} socket room and its existing join authorisation
 * wholesale (sockets/index.ts) rather than a second room topology — the
 * exact drift the M6 socket-room bypass bug came from.
 */
export const messageSenderRoleSchema = z.enum(['customer', 'agent'])
export type MessageSenderRole = z.infer<typeof messageSenderRoleSchema>

/**
 * The PERSISTED shape — matches models/Message.ts field for field, the same
 * relationship deliverySchema has to models/Delivery.ts. Deliberately
 * without a display name: the sender's name is resolved at read time
 * (routes/messages.ts), the same way a delivery's `agentName` is, rather
 * than stored and risking going stale. See messageViewSchema below for what
 * actually crosses the wire.
 */
export const messageSchema = z.object({
  _id: objectId,
  delivery: objectId,
  parcel: objectId,
  sender: objectId,
  senderRole: messageSenderRoleSchema,
  body: z.string().min(1).max(500),
  ...timestamps,
})
export type Message = z.infer<typeof messageSchema>

/** What actually reaches the client: the persisted message, name resolved. */
export const messageViewSchema = messageSchema.extend({
  senderName: z.string(),
})
export type MessageView = z.infer<typeof messageViewSchema>

export const postMessageInputSchema = z.object({
  body: z.string().trim().min(1, 'say something first').max(500),
})
export type PostMessageInput = z.infer<typeof postMessageInputSchema>

/** GET /messages/:deliveryId's response. */
export const messageThreadSchema = z.object({
  messages: z.array(messageViewSchema),
  /** Whether posting is allowed right now — PickedUp/InTransit only. */
  open: z.boolean(),
  /**
   * True for an admin: can read, can never post. The client states this
   * rather than hiding the thread (M9 brief) — admins read but don't
   * participate.
   */
  readOnly: z.boolean(),
})
export type MessageThread = z.infer<typeof messageThreadSchema>

/** Broadcast over the parcel's existing socket room on a successful post. */
export const messageBroadcastSchema = messageViewSchema.extend({
  parcelId: objectId,
})
export type MessageBroadcast = z.infer<typeof messageBroadcastSchema>

/**
 * How many messages persist per delivery before the oldest are pruned on
 * write — the same reasoning CLAUDE.md section 6 gives for capping location
 * history, applied to a persisted thread rather than an in-memory one. A
 * long-running delivery's chat must not grow this collection unbounded.
 */
export const MESSAGE_RETENTION_LIMIT = 200
