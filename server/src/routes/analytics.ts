import { Router } from 'express'
import { requireAuth, requireRole } from '../middleware/auth'
import { overview } from '../services/analytics'

export const analyticsRouter = Router()

/**
 * GET /analytics/overview — the admin dashboard's figures.
 *
 * Admin-only at the route, and unscoped by design inside: the service reads
 * every delivery in order to count them. `requireRole` is therefore the whole
 * of the access control here, which is exactly why it is the first thing on
 * the line rather than a check buried in the service.
 */
analyticsRouter.get('/overview', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    res.json(await overview())
  } catch (err) {
    next(err)
  }
})
