import { z } from 'zod'
import { objectId, taka, timestamps } from './common'

/**
 * Payments sit behind a PaymentProvider interface (CLAUDE.md section 2), so
 * this schema describes a payment generically and keeps Stripe's vocabulary
 * in one nullable field rather than spread across the document.
 */
export const paymentMethodSchema = z.enum(['cod', 'card'])
export type PaymentMethod = z.infer<typeof paymentMethodSchema>

export const paymentStatusSchema = z.enum([
  'pending',
  'paid',
  'failed',
  'refunded',
  /** COD collected by the rider but not yet handed to the office. */
  'collected',
  /** COD reconciled against the agent's ledger. */
  'settled',
])
export type PaymentStatus = z.infer<typeof paymentStatusSchema>

export const paymentSchema = z.object({
  _id: objectId,
  parcel: objectId,
  customer: objectId,
  /** Who collected the cash, for the per-agent reconciliation table in M5. */
  collectedBy: objectId.nullable(),
  method: paymentMethodSchema,
  status: paymentStatusSchema,
  amount: taka,
  /**
   * Provider-side identifier — a Stripe PaymentIntent id in card mode, null
   * for COD. Never a secret: no client_secret is persisted.
   */
  providerRef: z.string().max(200).nullable(),
  paidAt: z.coerce.date().nullable(),
  settledAt: z.coerce.date().nullable(),
  ...timestamps,
})
export type Payment = z.infer<typeof paymentSchema>
