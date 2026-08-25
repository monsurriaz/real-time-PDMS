import { z } from 'zod'
import { deliveryStatusSchema } from './delivery'

/**
 * GET /notifications — the header bell, v3.1 addendum.
 *
 * Not a new domain concept: there is no Notification model. Every row here
 * is read straight off `Delivery.events[]` (the most recent event on a
 * delivery this actor can see) or off `Delivery.expectedBy` (admin only,
 * the same "delayed" definition the analytics dashboard already uses) — the
 * bell surfaces data the app already has, it does not invent new data to
 * have something to show.
 *
 * `kind` exists so the client can pick a dot colour without restating the
 * status-vs-overdue distinction the server already made.
 */
export const notificationKindSchema = z.enum(['status', 'overdue'])
export type NotificationKind = z.infer<typeof notificationKindSchema>

export const notificationSchema = z.object({
  /** Stable per event, so the client's "seen" comparison survives a refetch. */
  id: z.string(),
  kind: notificationKindSchema,
  /** The lifecycle state this notification is about — drives the dot colour. */
  status: deliveryStatusSchema,
  title: z.string(),
  subtitle: z.string(),
  at: z.coerce.date(),
})
export type Notification = z.infer<typeof notificationSchema>

export const notificationsResponseSchema = z.object({
  notifications: z.array(notificationSchema),
})
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>
