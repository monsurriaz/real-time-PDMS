import { z } from 'zod'
import { cloudinaryUrl, objectId, taka, timestamps } from './common'

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

/**
 * What a customer is told about their own payment. A projection, not the
 * document: `providerRef` and everything Stripe-shaped stays server-side,
 * because section 7's rule about payment secrets is easiest to keep when the
 * client is never handed the vocabulary in the first place.
 */
export const paymentSummarySchema = z.object({
  _id: objectId,
  method: paymentMethodSchema,
  status: paymentStatusSchema,
  amount: taka,
  paidAt: z.coerce.date().nullable(),
})
export type PaymentSummary = z.infer<typeof paymentSummarySchema>

/**
 * Where to send the customer to pay. A URL and nothing else — no client
 * secret, no intent id.
 */
export const checkoutSessionSchema = z.object({
  url: z.string().url(),
  /** Which provider produced it, so the UI can name it honestly. */
  provider: z.string(),
})
export type CheckoutSession = z.infer<typeof checkoutSessionSchema>

/**
 * One rider's row in the admin COD reconciliation table.
 *
 * Every figure here is derived by query from Payment documents, never read
 * from a stored running total: a total that is written cannot be re-derived,
 * and a reconciliation table nobody can re-derive is not a reconciliation.
 */
export const codReconciliationRowSchema = z.object({
  agentId: objectId,
  agentName: z.string(),
  /** M9.6: the rider's own photo, alongside the name this row already shows. */
  avatarUrl: cloudinaryUrl.nullable(),
  /** COD parcels this rider actually delivered. */
  deliveredCount: z.number().int().nonnegative(),
  /** Cash in hand: delivered, not yet settled with the office. */
  outstanding: taka,
  outstandingCount: z.number().int().nonnegative(),
  /** Cash already handed in, across every settlement. */
  settled: taka,
  settledCount: z.number().int().nonnegative(),
  /**
   * COD that will never be collected because the delivery failed or was
   * cancelled. Shown so the table explains its own arithmetic instead of
   * silently omitting parcels (CLAUDE.md: a Failed delivery's COD must not
   * count as collectable).
   */
  uncollectable: taka,
  uncollectableCount: z.number().int().nonnegative(),
  lastSettledAt: z.coerce.date().nullable(),
})
export type CodReconciliationRow = z.infer<typeof codReconciliationRowSchema>

/**
 * One settlement: a rider handed cash to the office. Append-only by intent —
 * marking money settled writes one of these AND flips the payments it names,
 * so the audit trail records what was settled, not just that a total changed.
 */
export const settlementSchema = z.object({
  _id: objectId,
  agent: objectId,
  agentName: z.string(),
  amount: taka,
  paymentCount: z.number().int().nonnegative(),
  /** The admin who took the cash. */
  settledBy: objectId,
  settledByName: z.string(),
  at: z.coerce.date(),
  note: z.string().max(300).optional(),
})
export type Settlement = z.infer<typeof settlementSchema>

/**
 * POST /payments/settlements. The amount is deliberately absent: the server
 * settles exactly what that rider is holding, computed from the payments
 * themselves. A client-supplied amount could disagree with the ledger.
 */
export const settleInputSchema = z.object({
  agentId: objectId,
  note: z.string().max(300).optional(),
})
export type SettleInput = z.infer<typeof settleInputSchema>
