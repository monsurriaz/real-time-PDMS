import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computePrice, tierFor, type PricingRates } from './pricing'

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
      /do not price parcels over 5 kg/,
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
