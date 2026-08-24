import {
  heaviestPricedKg,
  tierFloor,
  type PriceBreakdown,
  type PricingConfig,
  type WeightTier,
  type ZoneName,
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

/** Same lookup, keeping the index — a formula tier needs its lower bound. */
export const tierIndexFor = (
  weightKg: number,
  tiers: readonly WeightTier[],
): number => tiers.findIndex((t) => weightKg <= t.maxKg)

/**
 * The weight term of the formula, in whole taka.
 *
 * A flat tier charges its baseFee. A tier carrying `perKgOver` charges
 * baseFee plus that rate for every kilogram above the tier's LOWER bound, so
 * the charge is continuous with the tier below it rather than jumping at the
 * boundary: with a 5 kg tier at BDT 130 beneath it, a 5-20 kg tier at
 * `perKgOver: 15` prices 5.0 kg at 130 and 8 kg at 175.
 *
 * Returns null when no tier covers the weight — the caller decides how to
 * refuse, because inventing a rate here is exactly what CLAUDE.md section 5
 * forbids.
 */
export const weightSurchargeFor = (
  weightKg: number,
  tiers: readonly WeightTier[],
): { tier: WeightTier; surcharge: number } | null => {
  const index = tierIndexFor(weightKg, tiers)
  const tier = index >= 0 ? tiers[index] : undefined
  if (!tier) return null

  const overage = Math.max(0, weightKg - tierFloor(tiers, index))
  const formula = tier.perKgOver ? tier.perKgOver * overage : 0
  return { tier, surcharge: Math.round(tier.baseFee + formula) }
}

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

  const weight = weightSurchargeFor(weightKg, rates.weightTiers)
  if (!weight) {
    /**
     * Above the heaviest tier there is no defined price, so we refuse and say
     * where the limit is. The alternatives are both dishonest: inventing a
     * surcharge would hard-code a rate the admin does not control, and falling
     * back to the top tier would undercharge without telling anyone.
     *
     * The limit is config-driven, so raising it is an edit in the pricing
     * editor rather than a deploy — which is why the message names the number
     * instead of describing a policy.
     */
    throw new PricingError(
      `we do not carry parcels over ${heaviestPricedKg(rates.weightTiers)} kg — ` +
        'the heaviest weight tier ends there',
    )
  }

  const distanceCost = Math.round(distanceKm * rates.perKmRate)
  const weightSurcharge = weight.surcharge
  const base = Math.round(zoneBase)

  return {
    zoneBase: base,
    distanceKm,
    perKmRate: rates.perKmRate,
    distanceCost,
    weightTierLabel: weight.tier.label,
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
