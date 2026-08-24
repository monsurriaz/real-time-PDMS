import express, { Router, type RequestHandler } from 'express'
import mongoose from 'mongoose'
import { settleInputSchema } from '@pdms/shared'
import { runAsSystem } from '../lib/context'
import { env } from '../lib/env'
import {
  getPaymentProvider,
  paymentsConfigured,
  WebhookVerificationError,
} from '../lib/payments'
import { PaymentModel } from '../models/Payment'
import { requireAuth, requireRole } from '../middleware/auth'
import { HttpError, unauthorized } from '../middleware/httpError'
import {
  applyProviderEvent,
  codReconciliation,
  settleAgent,
  settlementHistory,
  startCheckout,
  toSummary,
} from '../services/payments'

export const paymentsRouter = Router()

/**
 * GET /payments/config — is card payment available at all?
 *
 * The booking screen has to know before it offers to charge someone: a "Pay
 * now" button that 503s because a key is missing is worse than a screen that
 * says payment is not configured.
 */
paymentsRouter.get('/config', requireAuth, (_req, res) => {
  const enabled = paymentsConfigured()
  res.json({
    cardPayments: enabled,
    provider: enabled ? getPaymentProvider().name : null,
  })
})

/** GET /payments/parcel/:parcelId — where this parcel's money stands. */
paymentsRouter.get('/parcel/:parcelId', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.parcelId
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, 'not a valid parcel id')
    }
    // Scoped by the Payment model's own rule: a customer sees only their own.
    const payment = await PaymentModel.findOne({
      parcel: new mongoose.Types.ObjectId(id),
    })
      .select('method status amount paidAt')
      .lean<{
        _id: mongoose.Types.ObjectId
        method: 'cod' | 'card'
        status: 'pending' | 'paid' | 'failed' | 'refunded' | 'collected' | 'settled'
        amount: number
        paidAt: Date | null
      } | null>()
    if (!payment) throw new HttpError(404, 'no payment for this parcel')

    res.json({ payment: toSummary(payment) })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /payments/parcel/:parcelId/checkout — start a hosted checkout.
 *
 * Customer only, and only their own parcel: the scoped read inside the service
 * is what enforces the second half.
 */
paymentsRouter.post(
  '/parcel/:parcelId/checkout',
  requireAuth,
  requireRole('customer'),
  async (req, res, next) => {
    try {
      const actor = req.actor
      if (!actor) throw unauthorized()
      const id = req.params.parcelId
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new HttpError(400, 'not a valid parcel id')
      }

      res.json(await startCheckout({ parcelId: id, actor }))
    } catch (err) {
      next(err)
    }
  },
)

/** GET /payments/reconciliation — the per-agent COD table. Admin only. */
paymentsRouter.get(
  '/reconciliation',
  requireAuth,
  requireRole('admin'),
  async (_req, res, next) => {
    try {
      res.json(await codReconciliation())
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /payments/settlements — a rider handed in their cash.
 *
 * No amount in the body: the server settles exactly what the ledger says that
 * rider is holding. Accepting a figure from the client would let the audit
 * record disagree with the payments it names.
 */
paymentsRouter.post(
  '/settlements',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const actor = req.actor
      if (!actor) throw unauthorized()
      const input = settleInputSchema.parse(req.body)

      res.status(201).json({
        settlement: await settleAgent({
          agentId: input.agentId,
          actor,
          ...(input.note ? { note: input.note } : {}),
        }),
      })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * GET /payments/settlements — the audit trail, newest first.
 *
 * Readable by an admin for anyone and by a rider for themselves; the
 * Settlement model's scoping decides which, not this handler.
 */
paymentsRouter.get('/settlements', requireAuth, async (req, res, next) => {
  try {
    const agentId = (req.query as Record<string, string | undefined>).agentId
    res.json({
      settlements: await settlementHistory({
        ...(agentId ? { agentId } : {}),
      }),
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /payments/webhook — the provider telling us what happened.
 *
 * Mounted separately from the router above, in app.ts, BEFORE the JSON body
 * parser: the signature is computed over the exact bytes the provider sent, and
 * any parse-then-reserialise changes them. That mounting order is the single
 * most fragile thing about this endpoint, which is why the handler asserts the
 * body is still a Buffer rather than trusting it.
 *
 * There is no requireAuth here, deliberately. A webhook has no cookie; it
 * proves itself with a signature, which is a stronger claim than a session.
 */
export const webhookHandler: RequestHandler = (req, res) => {
  const provider = (() => {
    try {
      return getPaymentProvider()
    } catch {
      return null
    }
  })()

  if (!provider) {
    // 503, not 400: nothing is wrong with the request, we are just not set up
    // to receive it — and a provider should retry that, not give up.
    res.status(503).json({ error: 'payments are not configured on this server' })
    return
  }

  if (!Buffer.isBuffer(req.body)) {
    console.error(
      '[payments] webhook body is not raw — the JSON parser ran first and the signature can never verify',
    )
    res.status(500).json({ error: 'webhook body was parsed before verification' })
    return
  }

  let event
  try {
    event = provider.verifyEvent(req.body, req.header('stripe-signature'))
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      // 400 and no retry: an unverifiable event will not become verifiable.
      console.warn(`[payments] rejected webhook: ${err.message}`)
      res.status(400).json({ error: err.message })
      return
    }
    console.error('[payments] webhook verification blew up', err)
    res.status(400).json({ error: 'could not read that webhook' })
    return
  }

  /**
   * Answered without waiting for the ledger write. The provider only needs to
   * know we accepted the event; making it wait on our database is how retries
   * start piling up on a slow connection. The write is idempotent, so a retry
   * that arrives anyway is harmless.
   */
  void runAsSystem('payments: apply webhook', async () => {
    try {
      const result = await applyProviderEvent(event)
      console.log(
        `[payments] ${event.id} (${env.PAYMENT_PROVIDER}/${event.type}) -> ${result.outcome}${
          result.replay ? ' [replay, no-op]' : ''
        }`,
      )
    } catch (err) {
      console.error(`[payments] applying ${event.id} failed`, err)
    }
  })

  res.json({ received: true })
}

/** The raw-body parser this endpoint needs, kept next to the handler. */
export const webhookBodyParser = express.raw({ type: '*/*', limit: '1mb' })
