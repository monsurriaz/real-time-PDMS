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
  /**
   * Optional per-kilogram rate for weight ABOVE this tier's lower bound, on
   * top of baseFee. The lower bound is the previous tier's maxKg (0 for the
   * first tier), so a tier `{ maxKg: 20, baseFee: 130, perKgOver: 15 }` sitting
   * above a 5 kg tier prices 8 kg as 130 + 15 x 3 = 175.
   *
   * This is what lets a heavy parcel be priced honestly instead of refused,
   * WITHOUT hard-coding the rate: it is a field on the tier, so the admin
   * pricing editor still owns it (CLAUDE.md section 5). Absent means a flat
   * tier, which is why every existing tier keeps behaving exactly as before.
   */
  perKgOver: taka.optional(),
  label: z.string().min(1).max(40),
})
export type WeightTier = z.infer<typeof weightTierSchema>

/**
 * The lower bound of tier `index`: the previous tier's upper bound, or 0 for
 * the first. Exported because the admin editor has to tell the admin what
 * "over" means on a formula tier, and re-deriving it there would be a second
 * definition free to disagree with the one pricing uses.
 */
export const tierFloor = (
  tiers: readonly WeightTier[],
  index: number,
): number => (index <= 0 ? 0 : (tiers[index - 1]?.maxKg ?? 0))

/** The heaviest parcel any tier covers — the stated limit above which we refuse. */
export const heaviestPricedKg = (tiers: readonly WeightTier[]): number =>
  tiers.reduce((max, t) => Math.max(max, t.maxKg), 0)

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
/**
 * GET /pricing/summary — the three numbers the landing page's stat band
 * shows, from a route that needs no session (the landing page is public).
 * Deliberately smaller than pricingConfigSchema: a visitor gets the floor
 * fee and the weight cap, not the full tier ladder or the per-zone
 * overrides an admin edits from the dashboard.
 */
export const pricingSummarySchema = z.object({
  zoneCount: z.number().int().nonnegative(),
  floorFee: taka,
  weightCapKg: z.number().positive(),
})
export type PricingSummary = z.infer<typeof pricingSummarySchema>

/**
 * GET /pricing/tiers — the landing page's pricing section (M9.5), the same
 * "unauthenticated because the landing page is" reasoning as `/summary`
 * above, but this is the tier ladder itself: a visitor comparing rates needs
 * to see all of them, including the 5-20kg formula tier, not just the floor
 * fee. Still deliberately smaller than pricingConfigSchema — no
 * `zoneBaseOverrides`, which describe an admin's per-zone editing decisions
 * rather than a rate a visitor is quoted.
 */
export const pricingTiersSchema = z.object({
  perKmRate: taka,
  weightTiers: z.array(weightTierSchema).min(1),
})
export type PricingTiers = z.infer<typeof pricingTiersSchema>

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
