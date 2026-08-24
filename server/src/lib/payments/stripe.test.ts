import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { describe, it, before } from 'node:test'

/**
 * Webhook verification, tested against bytes rather than through Stripe.
 *
 * This is the code that would otherwise come from Stripe's SDK, so it carries
 * the weight the SDK would have: a signature check that accepts anything is a
 * webhook endpoint anyone can post to, and a double-credited payment is the
 * failure this milestone is most careful about.
 *
 * The env is seeded before the module loads because lib/env validates at
 * import time — this keeps the test hermetic instead of depending on a .env.
 */

const SECRET = 'whsec_test_secret_for_unit_tests'

let verifyEvent: (
  raw: Buffer,
  header: string | undefined,
) => {
  id: string
  type: 'succeeded' | 'failed' | 'ignored'
  paymentId: string | null
  providerRef: string | null
  amountMinor: number | null
}
let takaToMinor: (taka: number) => number
let minorToTaka: (minor: number) => number
let WebhookVerificationError: new (m: string) => Error

before(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET
  process.env.PAYMENT_PROVIDER = 'stripe'
  process.env.STRIPE_SECRET_KEY ??= 'sk_test_placeholder'
  process.env.MONGODB_URI ??= 'mongodb://localhost:27017/pdms-test'
  process.env.JWT_SECRET ??= 'a'.repeat(48)

  const stripe = await import('./stripe')
  const provider = await import('./provider')
  verifyEvent = stripe.stripeProvider.verifyEvent.bind(stripe.stripeProvider)
  takaToMinor = stripe.takaToMinor
  minorToTaka = stripe.minorToTaka
  WebhookVerificationError = provider.WebhookVerificationError
})

/** Sign a body exactly as Stripe does: HMAC over `${timestamp}.${body}`. */
const sign = (body: string, secondsAgo = 0): string => {
  const t = Math.floor(Date.now() / 1000) - secondsAgo
  const v1 = crypto
    .createHmac('sha256', SECRET)
    .update(`${t}.${body}`)
    .digest('hex')
  return `t=${t},v1=${v1}`
}

const session = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_123',
        payment_status: 'paid',
        amount_total: 12600,
        metadata: { paymentId: '507f1f77bcf86cd799439011', trackingId: 'PD-0001-AA' },
        ...over,
      },
    },
  })

describe('taka <-> minor units', () => {
  it('treats BDT as a two-decimal currency', () => {
    // Getting this wrong is a factor of 100 in someone's bank account.
    assert.equal(takaToMinor(126), 12_600)
    assert.equal(minorToTaka(12_600), 126)
    assert.equal(minorToTaka(takaToMinor(1_240)), 1_240)
  })
})

describe('stripe webhook verification', () => {
  it('accepts a correctly signed event and normalises it', () => {
    const body = session()
    const event = verifyEvent(Buffer.from(body), sign(body))
    assert.equal(event.type, 'succeeded')
    assert.equal(event.id, 'evt_1')
    assert.equal(event.paymentId, '507f1f77bcf86cd799439011')
    assert.equal(event.providerRef, 'cs_test_123')
    assert.equal(event.amountMinor, 12_600)
  })

  it('refuses a body that was altered after signing', () => {
    const body = session()
    const header = sign(body)
    // The classic attack: keep the signature, change the amount.
    const tampered = body.replace('12600', '1')
    assert.throws(
      () => verifyEvent(Buffer.from(tampered), header),
      WebhookVerificationError,
    )
  })

  it('refuses a missing or malformed signature header', () => {
    const body = session()
    assert.throws(() => verifyEvent(Buffer.from(body), undefined), WebhookVerificationError)
    assert.throws(() => verifyEvent(Buffer.from(body), 'nonsense'), WebhookVerificationError)
    assert.throws(
      () => verifyEvent(Buffer.from(body), 't=123'),
      WebhookVerificationError,
    )
  })

  it('refuses a signature made with a different secret', () => {
    const body = session()
    const t = Math.floor(Date.now() / 1000)
    const forged = crypto
      .createHmac('sha256', 'whsec_not_our_secret')
      .update(`${t}.${body}`)
      .digest('hex')
    assert.throws(
      () => verifyEvent(Buffer.from(body), `t=${t},v1=${forged}`),
      WebhookVerificationError,
    )
  })

  it('refuses a genuinely signed body replayed hours later', () => {
    const body = session()
    assert.throws(
      () => verifyEvent(Buffer.from(body), sign(body, 3 * 3600)),
      /tolerance/,
    )
  })

  it('accepts any of several v1 signatures, for a rotated secret', () => {
    const body = session()
    const t = Math.floor(Date.now() / 1000)
    const ours = crypto.createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')
    const other = crypto.createHmac('sha256', 'whsec_old').update(`${t}.${body}`).digest('hex')
    const event = verifyEvent(Buffer.from(body), `t=${t},v1=${other},v1=${ours}`)
    assert.equal(event.type, 'succeeded')
  })

  it('does not credit a completed session whose payment is still processing', () => {
    // completed != paid for delayed methods; async_payment_succeeded follows.
    const body = session({ payment_status: 'unpaid' })
    assert.equal(verifyEvent(Buffer.from(body), sign(body)).type, 'ignored')
  })

  it('maps expiry and async failure to a failed outcome', () => {
    for (const type of [
      'checkout.session.expired',
      'checkout.session.async_payment_failed',
    ]) {
      const body = JSON.stringify({
        id: `evt_${type}`,
        type,
        data: { object: { id: 'cs_x', payment_status: 'unpaid', amount_total: 100, metadata: {} } },
      })
      assert.equal(verifyEvent(Buffer.from(body), sign(body)).type, 'failed')
    }
  })

  it('treats an unsubscribed event as a no-op rather than an error', () => {
    // Stripe sends events nobody asked for; erroring would make it retry them
    // forever.
    const body = JSON.stringify({
      id: 'evt_other',
      type: 'customer.created',
      data: { object: { id: 'cus_1', payment_status: 'paid', amount_total: null, metadata: {} } },
    })
    assert.equal(verifyEvent(Buffer.from(body), sign(body)).type, 'ignored')
  })
})
