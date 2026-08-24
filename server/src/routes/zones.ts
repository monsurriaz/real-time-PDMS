import { Router } from 'express'
import { ZoneModel } from '../models/Zone'
import { requireAuth } from '../middleware/auth'

export const zonesRouter = Router()

/**
 * GET /zones — reference data for the booking form's zone picker and the
 * admin's per-zone override editor. Readable by every signed-in role.
 */
zonesRouter.get('/', requireAuth, async (_req, res, next) => {
  try {
    const zones = await ZoneModel.find({ isServiceable: true })
      .select('name label baseFare centre')
      .sort({ name: 1 })
      .lean()

    res.json({
      zones: zones.map((z) => ({
        name: z.name,
        label: z.label,
        baseFare: z.baseFare,
        centre: z.centre,
      })),
    })
  } catch (err) {
    next(err)
  }
})
