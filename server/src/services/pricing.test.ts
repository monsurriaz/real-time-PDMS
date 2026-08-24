import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { heaviestPricedKg, tierFloor } from '@pdms/shared'
import {
  computePrice,
  tierFor,
  weightSurchargeFor,
  type PricingRates,
} from './pricing'

/**
 * The seeded rates. Written out here rather than read from the database so
 * this stays a unit test of the arithmetic — the end-to-end check that the
 * real API path produces the same number lives separately.
 */
const RATES: PricingRates = {
  perKmRate: 12,
  weightTiers: [
    { maxKg: 1, baseFee: 60, label: 'Up to 1 kg' },
    { maxKg: 3, baseFee: 90, label: '1 - 3 kg' },
    { maxKg: 5, baseFee: 130, label: '3 - 5 kg' },
  ],
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

describe('computePrice', () => {
  it("reproduces CLAUDE.md's documented example: 3 km, 2 kg -> BDT 126", () => {
    const p = computePrice({ distanceKm: 3, weightKg: 2, zoneBase: 0 }, RATES)
    assert.equal(p.total, 126)
    // and the breakdown must explain that number, not just arrive at it
    assert.equal(p.zoneBase, 0)
    assert.equal(p.distanceCost, 36)
    assert.equal(p.weightSurcharge, 90)
    assert.equal(p.weightTierLabel, '1 - 3 kg')
    assert.equal(p.zoneBase + p.distanceCost + p.weightSurcharge, p.total)
  })

  it('applies the formula from section 5, term by term', () => {
    const p = computePrice({ distanceKm: 7.5, weightKg: 4, zoneBase: 25 }, RATES)
    assert.equal(p.distanceCost, 90) // round(7.5 * 12)
    assert.equal(p.weightSurcharge, 130) // 3-5 kg tier
    assert.equal(p.total, 25 + 90 + 130)
  })

  it('adds the zone base when the zone has one', () => {
    const withBase = computePrice({ distanceKm: 3, weightKg: 2, zoneBase: 40 }, RATES)
    assert.equal(withBase.total, 166) // 126 + 40
  })

  it('always produces a breakdown whose parts sum to the total', () => {
    for (const distanceKm of [0.4, 1, 2.7, 3.33, 9.07, 18.6]) {
      for (const weightKg of [0.5, 1, 1.01, 3, 3.5, 5]) {
        for (const zoneBase of [0, 15, 40]) {
          const p = computePrice({ distanceKm, weightKg, zoneBase }, RATES)
          assert.equal(
            p.zoneBase + p.distanceCost + p.weightSurcharge,
            p.total,
            `parts did not sum for ${distanceKm}km ${weightKg}kg base ${zoneBase}`,
          )
          assert.ok(Number.isInteger(p.total), 'total must be whole taka')
        }
      }
    }
  })

  it('reads rates from the config it is given, never a hard-coded value', () => {
    // Same inputs, different config -> different price. If any term were
    // hard-coded, one of these would not move.
    const doubled: PricingRates = {
      ...RATES,
      perKmRate: 24,
      weightTiers: RATES.weightTiers.map((t) => ({ ...t, baseFee: t.baseFee * 2 })),
    }
    const p = computePrice({ distanceKm: 3, weightKg: 2, zoneBase: 0 }, doubled)
    assert.equal(p.distanceCost, 72)
    assert.equal(p.weightSurcharge, 180)
    assert.equal(p.total, 252)
  })

  it('picks the lowest tier that covers the weight, inclusive of its bound', () => {
    assert.equal(tierFor(1, RATES.weightTiers)?.label, 'Up to 1 kg')
    assert.equal(tierFor(1.001, RATES.weightTiers)?.label, '1 - 3 kg')
    assert.equal(tierFor(3, RATES.weightTiers)?.label, '1 - 3 kg')
    assert.equal(tierFor(3.001, RATES.weightTiers)?.label, '3 - 5 kg')
    assert.equal(tierFor(5, RATES.weightTiers)?.label, '3 - 5 kg')
    assert.equal(tierFor(5.001, RATES.weightTiers), null)
  })

  it('refuses a weight beyond the heaviest tier rather than guessing', () => {
    assert.throws(
      () => computePrice({ distanceKm: 3, weightKg: 6, zoneBase: 0 }, RATES),
      /do not carry parcels over 5 kg/,
    )
  })

  it('rejects nonsense inputs', () => {
    assert.throws(() => computePrice({ distanceKm: -1, weightKg: 2, zoneBase: 0 }, RATES), /distance/)
    assert.throws(() => computePrice({ distanceKm: 3, weightKg: 0, zoneBase: 0 }, RATES), /weight/)
    assert.throws(
      () => computePrice({ distanceKm: Number.NaN, weightKg: 2, zoneBase: 0 }, RATES),
      /distance/,
    )
  })

  it('stamps the config version so a disputed price is auditable', () => {
    const p = computePrice({ distanceKm: 3, weightKg: 2, zoneBase: 0 }, RATES)
    assert.equal(p.pricingConfigVersion.toISOString(), '2026-01-01T00:00:00.000Z')
  })
})

/**
 * The formula tier that replaces the hard 5 kg ceiling.
 *
 * Seeded shape: the three flat tiers, then 5-20 kg at BDT 130 + BDT 15 for
 * every kilogram over 5. The rate is a FIELD on the tier, so these tests also
 * stand as the check that nothing about it is hard-coded — every number below
 * comes from HEAVY_RATES.
 */
const HEAVY_RATES: PricingRates = {
  perKmRate: 12,
  weightTiers: [
    { maxKg: 1, baseFee: 60, label: 'Up to 1 kg' },
    { maxKg: 3, baseFee: 90, label: '1 - 3 kg' },
    { maxKg: 5, baseFee: 130, label: '3 - 5 kg' },
    { maxKg: 20, baseFee: 130, perKgOver: 15, label: '5 - 20 kg' },
  ],
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

describe('formula weight tiers', () => {
  it("still reproduces CLAUDE.md's 3 km / 2 kg -> BDT 126 with the heavy tier present", () => {
    // The documented example must survive the schema change untouched: 2 kg
    // never reaches the formula tier.
    const p = computePrice({ distanceKm: 3, weightKg: 2, zoneBase: 0 }, HEAVY_RATES)
    assert.equal(p.total, 126)
    assert.equal(p.weightSurcharge, 90)
    assert.equal(p.weightTierLabel, '1 - 3 kg')
  })

  it('prices an 8 kg parcel instead of refusing it', () => {
    const p = computePrice({ distanceKm: 3, weightKg: 8, zoneBase: 0 }, HEAVY_RATES)
    // 130 + 15 x (8 - 5) = 175, plus 3 km x 12 = 36
    assert.equal(p.weightSurcharge, 175)
    assert.equal(p.distanceCost, 36)
    assert.equal(p.total, 211)
    assert.equal(p.zoneBase + p.distanceCost + p.weightSurcharge, p.total)
  })

  it('is continuous at the tier boundary rather than jumping', () => {
    // At exactly 5 kg the flat tier charges 130; a hair over, the formula tier
    // charges 130 plus a hair. A discontinuity here would mean a customer
    // paying materially more for 5.01 kg than for 5.00 kg.
    const at5 = computePrice({ distanceKm: 3, weightKg: 5, zoneBase: 0 }, HEAVY_RATES)
    const just = computePrice({ distanceKm: 3, weightKg: 5.01, zoneBase: 0 }, HEAVY_RATES)
    assert.equal(at5.weightSurcharge, 130)
    assert.equal(just.weightSurcharge, 130) // 130 + 15 x 0.01 = 130.15, rounds to 130
    assert.ok(just.total >= at5.total)
  })

  it('measures the overage from the tier floor, not from zero', () => {
    // From zero, 8 kg would be 130 + 15 x 8 = 250. The floor is what makes it 175.
    assert.equal(tierFloor(HEAVY_RATES.weightTiers, 3), 5)
    assert.equal(tierFloor(HEAVY_RATES.weightTiers, 0), 0)
    const w = weightSurchargeFor(8, HEAVY_RATES.weightTiers)
    assert.equal(w?.surcharge, 175)
  })

  it('scales with the configured rate, so nothing is hard-coded', () => {
    const doubled: PricingRates = {
      ...HEAVY_RATES,
      weightTiers: HEAVY_RATES.weightTiers.map((t) =>
        t.perKgOver ? { ...t, perKgOver: t.perKgOver * 2 } : t,
      ),
    }
    // 130 + 30 x 3 = 220
    assert.equal(
      computePrice({ distanceKm: 3, weightKg: 8, zoneBase: 0 }, doubled).weightSurcharge,
      220,
    )
  })

  it('refuses above the top tier and names the limit', () => {
    assert.equal(heaviestPricedKg(HEAVY_RATES.weightTiers), 20)
    assert.throws(
      () => computePrice({ distanceKm: 3, weightKg: 21, zoneBase: 0 }, HEAVY_RATES),
      /do not carry parcels over 20 kg/,
    )
    // 20 kg exactly is inside the tier — the bound is inclusive.
    assert.equal(
      computePrice({ distanceKm: 3, weightKg: 20, zoneBase: 0 }, HEAVY_RATES).weightSurcharge,
      355, // 130 + 15 x 15
    )
  })

  it('keeps every total whole and its parts summing, formula tier included', () => {
    for (const weightKg of [5.001, 5.5, 6, 7.33, 12.75, 19.99, 20]) {
      for (const distanceKm of [0.4, 3, 9.07]) {
        const p = computePrice({ distanceKm, weightKg, zoneBase: 15 }, HEAVY_RATES)
        assert.ok(Number.isInteger(p.total), `total not whole at ${weightKg}kg`)
        assert.equal(p.zoneBase + p.distanceCost + p.weightSurcharge, p.total)
      }
    }
  })

  it('never charges a heavier parcel less than a lighter one', () => {
    let previous = 0
    for (let kg = 0.5; kg <= 20; kg += 0.5) {
      const total = computePrice({ distanceKm: 3, weightKg: kg, zoneBase: 0 }, HEAVY_RATES).total
      assert.ok(total >= previous, `${kg} kg cost ${total}, less than the step below`)
      previous = total
    }
  })

  it('treats a tier with no perKgOver exactly as before', () => {
    const flat = weightSurchargeFor(2, HEAVY_RATES.weightTiers)
    assert.equal(flat?.surcharge, 90)
    assert.equal(flat?.tier.label, tierFor(2, HEAVY_RATES.weightTiers)?.label)
  })
})
