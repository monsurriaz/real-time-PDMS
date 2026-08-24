import { Router } from 'express'
import { z } from 'zod'
import {
  pricingConfigInputSchema,
  zoneName,
  type PricingConfigInput,
} from '@pdms/shared'
import { runAsSystem } from '../lib/context'
import { PricingConfigModel, type PricingConfigDoc } from '../models/PricingConfig'
import type { Timestamped } from '../models/types'
import { requireAuth, requireRole } from '../middleware/auth'
import { HttpError, badRequest } from '../middleware/httpError'
import { computePrice, priceFor, resolveZoneBase } from '../services/pricing'

export const pricingRouter = Router()

/**
 * The shape the admin editor reads and writes. Excludes Mongo bookkeeping so
 * the client is not tempted to send _id or timestamps back.
 */
type PricingDoc = Timestamped<PricingConfigDoc>

const serialise = (
  doc: PricingDoc,
): PricingConfigInput & { updatedAt: Date } => ({
  perKmRate: doc.perKmRate,
  weightTiers: doc.weightTiers.map((t) => ({
    maxKg: t.maxKg,
    baseFee: t.baseFee,
    label: t.label,
  })),
  zoneBaseOverrides: doc.zoneBaseOverrides.map((o) => ({
    zone: o.zone,
    baseFare: o.baseFare,
  })),
  updatedAt: doc.updatedAt,
})

/**
 * GET /pricing — readable by any signed-in role. A customer needs the rates
 * to understand a quote; scoping on the model allows all three roles.
 */
pricingRouter.get('/', requireAuth, async (_req, res, next) => {
  try {
    const config = await PricingConfigModel.findOne({ key: 'default' })
      .lean<PricingDoc | null>()
    if (!config) {
      throw new HttpError(503, 'pricing is not configured — run `npm run seed`')
    }
    res.json({ pricing: serialise(config) })
  } catch (err) {
    next(err)
  }
})

/**
 * PUT /pricing — admin only.
 *
 * Validation runs twice on purpose: here, so the admin gets field-level
 * errors, and again in the model's pre-validate hook, so the ascending /
 * non-overlapping rule holds even for a write that never passed through this
 * route. The definition of done requires the server to validate independently
 * of the client, and the model requires it independently of the route.
 */
pricingRouter.put('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const input = pricingConfigInputSchema.parse(req.body)

    // Reject duplicate zone overrides: two entries for one zone make the
    // resolved base ambiguous, and Zod cannot express that on an array.
    const zones = input.zoneBaseOverrides.map((o) => o.zone)
    const duplicates = zones.filter((z, i) => zones.indexOf(z) !== i)
    if (duplicates.length > 0) {
      throw badRequest(`duplicate zone override: ${[...new Set(duplicates)].join(', ')}`)
    }

    const updated = await runAsSystem('pricing: admin save', async () =>
      PricingConfigModel.findOneAndUpdate(
        { key: 'default' },
        { $set: input },
        {
          new: true,
          upsert: true,
          // runValidators makes the model's tier rules apply to this update,
          // not just to a full document save.
          runValidators: true,
          setDefaultsOnInsert: true,
        },
      ).lean<PricingDoc | null>().exec(),
    )

    if (!updated) throw new HttpError(500, 'pricing config could not be saved')
    res.json({ pricing: serialise(updated) })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /pricing/preview — the admin editor's live worked example.
 *
 * Takes the rates the admin is currently TYPING rather than the stored ones,
 * so the preview tracks unsaved edits. It still runs computePrice, the same
 * function that prices a real booking, because a second implementation on the
 * client would be free to drift from the real one — and CLAUDE.md section 5
 * asks for a worked example that reflects what is being edited.
 *
 * Nothing is written. The draft is validated first, so an admin mid-edit sees
 * why the preview cannot be computed instead of a stale number.
 */
const previewInputSchema = pricingConfigInputSchema.extend({
  distanceKm: z.number().nonnegative().max(10_000),
  weightKg: z.number().positive().max(1000),
  zone: zoneName.optional(),
})

pricingRouter.post('/preview', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const input = previewInputSchema.parse(req.body)

    /**
     * A zone override in the draft must be honoured even though it is
     * unsaved; otherwise the preview would contradict the table above it.
     * With no zone selected the base is 0, which is the case CLAUDE.md's
     * "3 km, 2 kg -> BDT 126" example describes.
     */
    const zoneBase = input.zone
      ? (input.zoneBaseOverrides.find((o) => o.zone === input.zone)?.baseFare ??
        (await resolveZoneBase(input.zone)))
      : 0

    const price = computePrice(
      { distanceKm: input.distanceKm, weightKg: input.weightKg, zoneBase },
      {
        perKmRate: input.perKmRate,
        weightTiers: input.weightTiers,
        // Draft rates are unsaved, so there is no stored version to cite.
        updatedAt: new Date(),
      },
    )

    res.json({ price })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /pricing/example?distanceKm=3&weightKg=2&zone=Dhanmondi
 *
 * The same worked example computed from the SAVED config. Used to confirm
 * what is currently in force, independent of any draft.
 */
pricingRouter.get('/example', requireAuth, async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>
    const distanceKm = Number(q.distanceKm ?? 3)
    const weightKg = Number(q.weightKg ?? 2)

    if (!Number.isFinite(distanceKm) || !Number.isFinite(weightKg)) {
      throw badRequest('distanceKm and weightKg must be numbers')
    }

    // No zone means "base case" — the documented 3 km / 2 kg -> 126 example
    // assumes a zero zone base.
    const zoneParam = q.zone
    if (!zoneParam) {
      const { loadRates } = await import('../services/pricing')
      const rates = await loadRates()
      res.json({ price: computePrice({ distanceKm, weightKg, zoneBase: 0 }, rates) })
      return
    }

    const zone = zoneName.parse(zoneParam)
    res.json({ price: await priceFor({ distanceKm, weightKg, zone }) })
  } catch (err) {
    next(err)
  }
})
