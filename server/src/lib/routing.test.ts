import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ROUTE_CACHE_TTL_DAYS, isFresh } from './routing'

/**
 * The route cache used to write `lookedUpAt` and never read it, so an entry
 * cached once was served forever — a changed road would keep producing the old
 * line indefinitely.
 */
describe('route cache freshness', () => {
  const now = Date.parse('2026-08-24T12:00:00Z')
  const daysAgo = (d: number): Date => new Date(now - d * 24 * 3_600_000)

  it('serves a recent entry from cache', () => {
    assert.equal(isFresh(daysAgo(0), now), true)
    assert.equal(isFresh(daysAgo(ROUTE_CACHE_TTL_DAYS - 1), now), true)
  })

  it('treats anything past the TTL as stale', () => {
    assert.equal(isFresh(daysAgo(ROUTE_CACHE_TTL_DAYS), now), false)
    assert.equal(isFresh(daysAgo(400), now), false)
  })

  it('treats a missing timestamp as stale rather than as fresh', () => {
    // Rows written before lookedUpAt existed must refresh, not be trusted
    // forever on the strength of an absent field.
    assert.equal(isFresh(undefined, now), false)
    assert.equal(isFresh(null, now), false)
  })
})
