import type {
  PriceBreakdown,
  PricingConfig,
  WeightTier,
  ZoneName,
} from '@pdms/shared'
import { runAsSystem } from '../lib/context'
import { PricingConfigModel, type PricingConfigDoc } from '../models/PricingConfig'
import { ZoneModel } from '../models/Zone'
import type { Timestamped } from '../models/types'
import { HttpError } from '../middleware/httpError'

/**
 * price = zoneBase + (distanceKm x perKmRate) + weightTierSurcharge
 *
 * Exactly the formula in CLAUDE.md section 5. Every term is read from the
 * live PricingConfig document; nothing here is hard-coded, which is what lets
 * an admin change a rate from the dashboard with no deploy.
 */

/** The three terms, already resolved. Keeping this separate from the config
 *  lookup is what makes the arithmetic a pure function. */
export interface PriceInputs {
  distanceKm: number
  weightKg: number
  /** Resolved by resolveZoneBase — an override if set, else the zone's fare. */
  zoneBase: number
}

/** The config fields pricing actually reads. */
export type PricingRates = Pick<PricingConfig, 'perKmRate' | 'weightTiers'> & {
  updatedAt: Date
}

export class PricingError extends HttpError {
  constructor(message: string) {
    super(422, message)
    this.name = 'PricingError'
  }
}

/**
 * The first tier whose upper bound covers the weight. Tiers are validated
 * ascending and non-overlapping on save, so the first match is the only match.
 */
export const tierFor = (
  weightKg: number,
  tiers: readonly WeightTier[],
): WeightTier | null => tiers.find((t) => weightKg <= t.maxKg) ?? null

/**
 * PURE. Same inputs always give the same breakdown — no database, no clock,
 * no config lookup. This is the function the tests and the admin's live
 * worked example both call, so the number an admin previews is produced by
 * the same code that prices a real booking.
 *
 * Each money term is rounded to whole taka independently and the total is
 * their sum, so the breakdown a customer sees always adds up. Rounding the
 * total instead would let the parts disagree with it by a taka.
 */
export const computePrice = (
  inputs: PriceInputs,
  rates: PricingRates,
): PriceBreakdown => {
  const { distanceKm, weightKg, zoneBase } = inputs

  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new PricingError('distance must be a non-negative number')
  }
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new PricingError('weight must be greater than zero')
  }

  const tier = tierFor(weightKg, rates.weightTiers)
  if (!tier) {
    /**
     * CLAUDE.md's tiers stop at 5 kg while the parcel schema allows far more,
     * so a heavier parcel has no defined price. Refusing is the only honest
     * option — inventing a surcharge would be hard-coding a rate, and falling
     * back to the top tier would undercharge without telling anyone.
     */
    const heaviest = rates.weightTiers.reduce((m, t) => Math.max(m, t.maxKg), 0)
    throw new PricingError(
      `we do not price parcels over ${heaviest} kg — the heaviest tier ends there`,
    )
  }

  const distanceCost = Math.round(distanceKm * rates.perKmRate)
  const weightSurcharge = Math.round(tier.baseFee)
  const base = Math.round(zoneBase)

  return {
    zoneBase: base,
    distanceKm,
    perKmRate: rates.perKmRate,
    distanceCost,
    weightTierLabel: tier.label,
    weightSurcharge,
    total: base + distanceCost + weightSurcharge,
    pricingConfigVersion: rates.updatedAt,
  }
}

/** The singleton config. Fails loudly rather than inventing defaults. */
export const loadRates = async (): Promise<PricingRates> => {
  const config = await runAsSystem('pricing: load config', async () =>
    PricingConfigModel.findOne({ key: 'default' })
      .lean<Timestamped<PricingConfigDoc> | null>()
      .exec(),
  )
  if (!config) {
    throw new HttpError(
      503,
      'pricing is not configured — run `npm run seed` to create the PricingConfig',
    )
  }
  return {
    perKmRate: config.perKmRate,
    weightTiers: config.weightTiers,
    updatedAt: config.updatedAt,
  }
}

/**
 * zoneBase for a zone: the PricingConfig override when the admin has set one,
 * otherwise the zone's own baseFare.
 *
 * Section 5 calls the per-zone entry an *optional override*, which implies a
 * default underneath it — that default is Zone.baseFare.
 */
export const resolveZoneBase = async (zone: ZoneName): Promise<number> => {
  const [config, zoneDoc] = await runAsSystem('pricing: zone base', async () =>
    Promise.all([
      PricingConfigModel.findOne({ key: 'default' }).lean().exec(),
      ZoneModel.findOne({ name: zone }).lean().exec(),
    ]),
  )

  const override = config?.zoneBaseOverrides?.find((o) => o.zone === zone)
  if (override) return override.baseFare

  if (!zoneDoc) throw new PricingError(`${zone} is not a serviceable zone`)
  return zoneDoc.baseFare
}

/**
 * The full path used by the quote and booking routes: resolve the zone base
 * and the live rates, then run the pure calculation.
 */
export const priceFor = async (args: {
  distanceKm: number
  weightKg: number
  zone: ZoneName
}): Promise<PriceBreakdown> => {
  const [zoneBase, rates] = await Promise.all([
    resolveZoneBase(args.zone),
    loadRates(),
  ])
  return computePrice(
    { distanceKm: args.distanceKm, weightKg: args.weightKg, zoneBase },
    rates,
  )
}
