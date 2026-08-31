import rateLimit from 'express-rate-limit'
import { isProd } from '../lib/env'

/**
 * M10 (production readiness): brute-force / scraping protection on the three
 * routes that take unauthenticated input from strangers. Everything else
 * either requires a session (and so a stolen cookie, not a guessed password,
 * is the actual risk) or is already behind `requireAuth`.
 *
 * One shared error shape (`{ error }`) so the client's fetch wrapper — which
 * already expects that shape from `errorHandler` — has nothing special to
 * handle for a 429.
 *
 * Disabled outside production: the free-tier demo runs from one laptop on one
 * network, and a limiter tuned tight enough to matter in production would
 * otherwise fire during ordinary local development (a typo'd password
 * retried a few times, or a test script looping a login).
 */
const disabledInDev = !isProd

const handler: import('express-rate-limit').Options['handler'] = (_req, res) => {
  res.status(429).json({ error: 'too many requests — try again shortly' })
}

/**
 * POST /auth/login and POST /auth/register. Keyed on IP, which is why
 * `app.set('trust proxy', ...)` in app.ts matters — Render sits behind a
 * reverse proxy, and without it every request looks like it came from the
 * same address and one guesser's lockout becomes everyone's.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => disabledInDev,
  handler,
})

/**
 * GET /tracking/by-id/:trackingId. No auth, no ownership check by design (see
 * that route's own comment) — the limiter is what stands between it and
 * someone enumerating `PD-XXXX-XX` space. Looser than the auth limiter: a
 * customer refreshing a tracking page repeatedly is normal use, not abuse.
 */
export const publicTrackingRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => disabledInDev,
  handler,
})
