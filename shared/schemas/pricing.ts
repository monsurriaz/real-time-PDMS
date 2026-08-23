import { z } from 'zod'
import { objectId, taka, timestamps, zoneName } from './common'

/**
 * price = zoneBase + (distanceKm x perKmRate) + weightTierSurcharge
 *
 * All three terms come from the single PricingConfig document — CLAUDE.md
 * section 5 forbids hard-coding any of them. Admins edit this from the
 * dashboard, so validation lives here in /shared and runs on both sides.
 */

export const weightTierSchema = z.object({
  /** Upper bound of the tier, inclusive. The lowest tier starts at 0 kg. */
  maxKg: z.number().positive().max(1000),
  baseFee: taka,
  label: z.string().min(1).max(40),
})
export type WeightTier = z.infer<typeof weightTierSchema>

export const zoneBaseOverrideSchema = z.object({
  zone: zoneName,
  baseFare: taka,
})
export type ZoneBaseOverride = z.infer<typeof zoneBaseOverrideSchema>

/**
 * Tiers must be ascending and non-overlapping (CLAUDE.md section 5). Because
 * each tier is described only by its upper bound, "non-overlapping" reduces
 * to "strictly increasing maxKg" — two tiers with the same bound would make
 * the lookup ambiguous, and a decreasing bound would make a tier
 * unreachable.
 */
const ascendingTiers = (tiers: WeightTier[], ctx: z.RefinementCtx): void => {
  for (let i = 1; i < tiers.length; i += 1) {
    const prev = tiers[i - 1]
    const curr = tiers[i]
    if (!prev || !curr) continue
    if (curr.maxKg <= prev.maxKg) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [i, 'maxKg'],
        message: `tier ${i + 1} (${curr.maxKg} kg) must exceed tier ${i} (${prev.maxKg} kg) — tiers must ascend and not overlap`,
      })
    }
  }
}

export const pricingConfigSchema = z.object({
  _id: objectId,
  /**
   * Singleton marker. Mongo gets a unique index on this, which is what makes
   * "there is exactly one PricingConfig" a database guarantee rather than a
   * convention someone has to remember.
   */
  key: z.literal('default'),
  perKmRate: taka,
  weightTiers: z
    .array(weightTierSchema)
    .min(1, 'at least one weight tier is required')
    .superRefine(ascendingTiers),
  /** Optional per-zone base, overriding Zone.baseFare when present. */
  zoneBaseOverrides: z.array(zoneBaseOverrideSchema).default([]),
  ...timestamps,
})
export type PricingConfig = z.infer<typeof pricingConfigSchema>

/** What the admin pricing editor submits. */
export const pricingConfigInputSchema = pricingConfigSchema.pick({
  perKmRate: true,
  weightTiers: true,
  zoneBaseOverrides: true,
})
export type PricingConfigInput = z.infer<typeof pricingConfigInputSchema>

/**
 * The price snapshot written onto a Parcel at booking time. Stored as a
 * breakdown, not just a total, so a later config edit can never retroactively
 * change what a customer was quoted (CLAUDE.md section 5) and so the invoice
 * can show its own arithmetic.
 */
export const priceBreakdownSchema = z.object({
  zoneBase: taka,
  distanceKm: z.number().nonnegative(),
  perKmRate: taka,
  distanceCost: taka,
  weightTierLabel: z.string(),
  weightSurcharge: taka,
  total: taka,
  /** Which config produced this, for auditing a disputed price. */
  pricingConfigVersion: z.coerce.date(),
})
export type PriceBreakdown = z.infer<typeof priceBreakdownSchema>
