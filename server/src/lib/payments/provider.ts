/**
 * The payment boundary (CLAUDE.md section 2: "Stripe test mode behind a
 * PaymentProvider interface").
 *
 * Everything below this file speaks Stripe. Everything above it speaks these
 * types — which is what makes "the rest of the app talks to the interface" a
 * checkable claim rather than an intention: grep for `stripe` outside
 * ./stripe.ts and the answer should be the env keys and nothing else.
 *
 * The interface is deliberately narrow. It does two things a provider must do
 * that we cannot: take money, and prove that a callback about money is
 * genuinely from the provider. Deciding what a payment MEANS — which parcel,
 * which amount, whether it has already been applied — stays in our own
 * services, where the snapshot rules from section 5 live.
 */

/** Amounts cross this boundary in minor units, as every provider expects. */
export interface CheckoutRequest {
  /** Our Payment document id. Comes back on the webhook as the correlation. */
  paymentId: string
  trackingId: string
  /** Whole taka, straight from the Parcel.price snapshot. */
  amountTaka: number
  description: string
  successUrl: string
  cancelUrl: string
}

export interface CheckoutResult {
  /** Where to send the customer. */
  url: string
  /** The provider's own id for this attempt, stored as Payment.providerRef. */
  providerRef: string
}

/**
 * A provider callback, normalised.
 *
 * `type` is ours, not the provider's: a provider has dozens of event names and
 * our ledger has three outcomes. Anything we do not act on arrives as
 * 'ignored', so an unfamiliar event is a no-op rather than an error — Stripe
 * will send events nobody subscribed to and retrying them forever is worse
 * than acknowledging them.
 */
export interface ProviderEvent {
  /** The provider's event id. The idempotency key — see services/payments.ts. */
  id: string
  type: 'succeeded' | 'failed' | 'ignored'
  /** Our Payment id, echoed back from CheckoutRequest.paymentId. */
  paymentId: string | null
  providerRef: string | null
  /** Minor units, as the provider reported them. Checked against our ledger. */
  amountMinor: number | null
}

/** Thrown when a callback cannot be proven to come from the provider. */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebhookVerificationError'
  }
}

export interface PaymentProvider {
  /** Shown to the user; also what gets logged. */
  readonly name: string
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>
  /**
   * Verify and normalise a callback. Takes the RAW body: any re-serialisation
   * changes the bytes the signature was computed over, which is why the
   * webhook route is mounted before the JSON body parser.
   *
   * Throws WebhookVerificationError rather than returning a flag, so an
   * unverified event cannot be acted on by a caller that forgot to check.
   */
  verifyEvent(rawBody: Buffer, signatureHeader: string | undefined): ProviderEvent
}
