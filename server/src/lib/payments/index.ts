import { env } from '../env'
import type { PaymentProvider } from './provider'
import { stripeProvider } from './stripe'

/**
 * Which provider is in force, chosen by PAYMENT_PROVIDER.
 *
 * A missing configuration is an explicit refusal rather than a silent
 * pretend-success: a payment that appears to work while nothing was charged is
 * the one failure mode worth being loud about.
 */
export const getPaymentProvider = (): PaymentProvider => {
  switch (env.PAYMENT_PROVIDER) {
    case 'stripe':
      return stripeProvider
    default:
      throw new Error(
        'no payment provider configured — set PAYMENT_PROVIDER=stripe and the STRIPE_* keys in .env',
      )
  }
}

/** True when card payment is available, for a UI that should not offer it otherwise. */
export const paymentsConfigured = (): boolean =>
  env.PAYMENT_PROVIDER === 'stripe' &&
  env.STRIPE_SECRET_KEY !== undefined &&
  env.STRIPE_WEBHOOK_SECRET !== undefined

export { WebhookVerificationError } from './provider'
export type { PaymentProvider, ProviderEvent } from './provider'
