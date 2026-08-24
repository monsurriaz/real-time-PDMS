import crypto from 'node:crypto'
import { requireEnv } from '../env'
import {
  WebhookVerificationError,
  type CheckoutRequest,
  type CheckoutResult,
  type PaymentProvider,
  type ProviderEvent,
} from './provider'

/**
 * Stripe, test mode, over its REST API.
 *
 * No SDK: CLAUDE.md forbids adding a dependency without asking, and everything
 * this needs is two `fetch` calls and one HMAC. The trade is that the two
 * places Stripe's own library would help — form encoding and signature
 * verification — are written out below rather than imported. Both are short
 * and both are covered by tests.
 *
 * The only Stripe vocabulary in this project lives in this file.
 */

const API = 'https://api.stripe.com/v1'

/**
 * BDT is a two-decimal currency to Stripe, so taka become poisha. Getting this
 * wrong is a factor of 100 in either direction, which is why it is a named
 * function with the reasoning attached rather than an inline `* 100`.
 */
const CURRENCY = 'bdt'
export const takaToMinor = (taka: number): number => Math.round(taka * 100)
export const minorToTaka = (minor: number): number => Math.round(minor / 100)

/**
 * Stripe takes form-encoded bodies with bracketed paths for nesting. Built by
 * hand from a flat map so every field is visible at the call site.
 */
const form = (fields: Record<string, string | number>): string =>
  Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')

interface StripeError {
  error?: { message?: string; type?: string }
}

interface StripeCheckoutSession {
  id: string
  url: string | null
  payment_intent: string | null
  amount_total: number | null
  payment_status: string
  metadata?: Record<string, string>
}

interface StripeEventEnvelope {
  id: string
  type: string
  data: { object: StripeCheckoutSession }
}

const call = async <T>(
  path: string,
  body: Record<string, string | number>,
): Promise<T> => {
  const secret = requireEnv('STRIPE_SECRET_KEY', 'card payments')

  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      /**
       * Pinned so a Stripe API change cannot alter the response shape under a
       * deployed build. Chosen as the version current when M5 was written.
       */
      'Stripe-Version': '2024-06-20',
    },
    body: form(body),
  })

  const text = await res.text()
  const parsed: unknown = text ? JSON.parse(text) : {}

  if (!res.ok) {
    const message = (parsed as StripeError).error?.message ?? res.statusText
    // Surfaced as-is: Stripe's test-mode messages are specific and useful
    // ("you cannot use a live card in test mode"), and hiding them would make
    // a demo failure unexplainable.
    throw new Error(`stripe: ${message}`)
  }
  return parsed as T
}

/**
 * Timing-safe compare of two hex digests. `crypto.timingSafeEqual` throws on
 * length mismatch, so the length is checked first.
 */
const sameDigest = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

/** Stripe's `Stripe-Signature: t=...,v1=...` header, parsed. */
const parseSignature = (
  header: string,
): { timestamp: string; signatures: string[] } => {
  const parts = header.split(',').map((p) => p.trim())
  let timestamp = ''
  const signatures: string[] = []
  for (const part of parts) {
    const [key, value] = part.split('=')
    if (!key || !value) continue
    if (key === 't') timestamp = value
    // A rotated secret means Stripe sends more than one v1 — accept any match.
    if (key === 'v1') signatures.push(value)
  }
  return { timestamp, signatures }
}

/** Reject a replay of a genuinely-signed body from long ago. */
const TOLERANCE_SECONDS = 5 * 60

/**
 * Which Stripe events we act on. Checkout is the flow, so the session's own
 * completion is the signal; `async_payment_*` covers the delayed methods where
 * completion and payment are not the same moment.
 */
const SUCCESS_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
])
const FAILURE_EVENTS = new Set([
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
])

export const stripeProvider: PaymentProvider = {
  name: 'Stripe (test mode)',

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const session = await call<StripeCheckoutSession>('/checkout/sessions', {
      mode: 'payment',
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': CURRENCY,
      'line_items[0][price_data][unit_amount]': takaToMinor(request.amountTaka),
      'line_items[0][price_data][product_data][name]': request.description,
      /**
       * Our own id, carried by Stripe and returned on the webhook. This is the
       * whole correlation mechanism: the webhook never has to guess which
       * parcel an event belongs to, and never has to trust a URL parameter.
       */
      'metadata[paymentId]': request.paymentId,
      'metadata[trackingId]': request.trackingId,
      client_reference_id: request.paymentId,
    })

    if (!session.url) {
      throw new Error('stripe: checkout session came back without a URL')
    }
    return { url: session.url, providerRef: session.id }
  },

  verifyEvent(rawBody: Buffer, signatureHeader: string | undefined): ProviderEvent {
    const secret = requireEnv('STRIPE_WEBHOOK_SECRET', 'payment webhooks')
    if (!signatureHeader) {
      throw new WebhookVerificationError('no Stripe-Signature header')
    }

    const { timestamp, signatures } = parseSignature(signatureHeader)
    if (!timestamp || signatures.length === 0) {
      throw new WebhookVerificationError('malformed Stripe-Signature header')
    }

    /**
     * The signed payload is `${timestamp}.${rawBody}` — the raw bytes, not a
     * re-encoded object. If this ever starts failing, suspect a body parser
     * upstream of the route before suspecting the secret.
     */
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex')

    if (!signatures.some((candidate) => sameDigest(candidate, expected))) {
      throw new WebhookVerificationError('signature does not match')
    }

    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))
    if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) {
      throw new WebhookVerificationError(
        `timestamp is ${age}s away from now — outside the ${TOLERANCE_SECONDS}s tolerance`,
      )
    }

    const event = JSON.parse(rawBody.toString('utf8')) as StripeEventEnvelope
    const session = event.data?.object

    const type: ProviderEvent['type'] = SUCCESS_EVENTS.has(event.type)
      ? // A completed session whose payment is still processing is not paid
        // yet; the async_payment_succeeded event will follow.
        session?.payment_status === 'paid'
        ? 'succeeded'
        : 'ignored'
      : FAILURE_EVENTS.has(event.type)
        ? 'failed'
        : 'ignored'

    return {
      id: event.id,
      type,
      paymentId: session?.metadata?.paymentId ?? null,
      providerRef: session?.id ?? null,
      amountMinor: session?.amount_total ?? null,
    }
  },
}
