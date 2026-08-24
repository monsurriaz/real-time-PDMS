import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { TIE_BREAK_METRES, rankCandidates, type Candidate } from './assignment'

/**
 * Assignment ranking: nearest first (CLAUDE.md section 5), with workload
 * breaking ties.
 *
 * The rule this protects is that workload must never override distance — it
 * decides only between riders the distance rule cannot separate. Availability
 * flips at PickedUp rather than at Assigned, so "available" said nothing about
 * how much a rider was already holding and the nearest one could absorb every
 * booking in their zone.
 */

const rider = (
  name: string,
  distanceMetres: number | null,
  activeDeliveries: number,
): Candidate => ({
  agentId: name,
  userId: name,
  name,
  vehicle: 'bike',
  zones: ['Dhanmondi'],
  distanceMetres,
  activeDeliveries,
})

const order = (list: Candidate[]): string[] => rankCandidates(list).map((c) => c.name)

describe('candidate ranking', () => {
  it('puts the nearest rider first when the gap is real', () => {
    // Busy-but-close still wins: a rider 4 km away is a worse answer for the
    // customer however free they are.
    assert.deepEqual(
      order([rider('far-and-free', 4_000, 0), rider('near-and-busy', 200, 3)]),
      ['near-and-busy', 'far-and-free'],
    )
  })

  it('prefers the freer rider when both are effectively the same distance', () => {
    assert.deepEqual(
      order([rider('busy', 250, 2), rider('free', 300, 0)]),
      ['free', 'busy'],
    )
  })

  it('treats the tie-break threshold as the boundary it claims to be', () => {
    const inside = order([
      rider('busy-closer', 100, 2),
      rider('free-further', 100 + TIE_BREAK_METRES, 0),
    ])
    assert.deepEqual(inside, ['free-further', 'busy-closer'], 'inside the band, load decides')

    const outside = order([
      rider('busy-closer', 100, 2),
      rider('free-further', 100 + TIE_BREAK_METRES + 1, 0),
    ])
    assert.deepEqual(outside, ['busy-closer', 'free-further'], 'outside it, distance decides')
  })

  it('falls back to distance when two riders carry the same load', () => {
    assert.deepEqual(order([rider('b', 280, 1), rider('a', 120, 1)]), ['a', 'b'])
  })

  it('ranks by load alone when nobody has a known distance', () => {
    // The zone-only fallback for a parcel with no geocoded pick-up.
    assert.deepEqual(
      order([rider('three', null, 3), rider('none', null, 0), rider('one', null, 1)]),
      ['none', 'one', 'three'],
    )
  })

  it('puts a rider with a known distance ahead of one without', () => {
    assert.deepEqual(order([rider('unknown', null, 0), rider('known', 900, 4)]), [
      'known',
      'unknown',
    ])
  })

  it('does not mutate the list it was given', () => {
    const input = [rider('b', 900, 0), rider('a', 100, 0)]
    rankCandidates(input)
    assert.deepEqual(input.map((c) => c.name), ['b', 'a'])
  })
})
