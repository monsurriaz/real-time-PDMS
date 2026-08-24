import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type Express } from 'express'
import mongoose from 'mongoose'
import { env } from './lib/env'
import { attachActor } from './middleware/auth'
import { errorHandler, notFoundHandler } from './middleware/httpError'
import { agentsRouter } from './routes/agents'
import { analyticsRouter } from './routes/analytics'
import { authRouter } from './routes/auth'
import { deliveriesRouter } from './routes/deliveries'
import { parcelsRouter } from './routes/parcels'
import {
  paymentsRouter,
  webhookBodyParser,
  webhookHandler,
} from './routes/payments'
import { pricingRouter } from './routes/pricing'
import { trackingRouter } from './routes/tracking'
import { zonesRouter } from './routes/zones'
// Registers every model with Mongoose before any route can query one.
import './models'

export const createApp = (): Express => {
  const app = express()

  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      // Required for the auth cookie to travel at all.
      credentials: true,
    }),
  )
  /**
   * The payment webhook, mounted BEFORE the JSON parser.
   *
   * Its signature is computed over the raw bytes the provider sent, so the
   * body must reach the handler unparsed. Everything else on the app still gets
   * express.json() from the line below — this is one route with one parser, not
   * a global change.
   */
  app.post('/payments/webhook', webhookBodyParser, webhookHandler)

  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  /**
   * Global, and before every route: opens the async context that Mongoose
   * role scoping reads. Mounting this per-router instead would recreate
   * exactly the "one handler forgot" failure that CLAUDE.md section 7 is
   * written to prevent.
   */
  app.use(attachActor)

  app.get('/health', (_req, res) => {
    // 1 === connected. Useful when the demo machine's network drops.
    const dbUp = mongoose.connection.readyState === 1
    res.status(dbUp ? 200 : 503).json({
      ok: dbUp,
      db: mongoose.connection.readyState,
      env: env.NODE_ENV,
    })
  })

  app.use('/auth', authRouter)
  app.use('/zones', zonesRouter)
  app.use('/pricing', pricingRouter)
  app.use('/parcels', parcelsRouter)
  app.use('/deliveries', deliveriesRouter)
  app.use('/agents', agentsRouter)
  app.use('/payments', paymentsRouter)
  app.use('/analytics', analyticsRouter)
  app.use('/tracking', trackingRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
