import type { AddressInput, GeoPoint, GeocodedAddress } from '@pdms/shared'
import { GeocodeCacheModel } from '../models/GeocodeCache'
import { runAsSystem } from './context'
import { env } from './env'
import { LookupError } from './lookupError'
import { createThrottle } from './throttle'

/**
 * Nominatim, wrapped to satisfy CLAUDE.md section 2: a real User-Agent, at
 * most one request per second, and every result cached in Mongo.
 */

const NOMINATIM_MIN_INTERVAL_MS = 1_100 // a little over 1s, for clock skew
const REQUEST_TIMEOUT_MS = 12_000

const throttle = createThrottle(NOMINATIM_MIN_INTERVAL_MS)

/**
 * Dhaka's rough bounding box. Nominatim will happily return a same-named
 * street in another country, and a pickup point 6000 km away would sail
 * through pricing and then strand a rider — so anything outside the box is
 * treated as not found rather than trusted.
 */
const DHAKA_BOUNDS = {
  minLng: 90.2,
  maxLng: 90.6,
  minLat: 23.6,
  maxLat: 23.95,
} as const

const withinServiceArea = (lng: number, lat: number): boolean =>
  lng >= DHAKA_BOUNDS.minLng &&
  lng <= DHAKA_BOUNDS.maxLng &&
  lat >= DHAKA_BOUNDS.minLat &&
  lat <= DHAKA_BOUNDS.maxLat

/**
 * Every forward-geocode caller (booking's pickup/drop, and M9.7's "type an
 * address" rider location tier) only ever needs these four fields — narrower
 * than `AddressInput` on purpose, so a caller with no `contactName`/
 * `contactPhone` to give (a rider is not a parcel) can still call this
 * without fabricating them. `AddressInput` itself satisfies this structurally,
 * so every existing call site needs no change.
 */
type GeocodableAddress = Pick<AddressInput, 'line1' | 'area' | 'zone' | 'city'>

/**
 * The cache key. Normalising means "House 12, Road 3" and "house 12  road 3"
 * are one cache entry rather than two, which matters because the same
 * customer sends from the same address repeatedly.
 */
export const normaliseAddress = (a: GeocodableAddress): string =>
  [a.line1, a.area, a.zone, a.city]
    .join(' ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // punctuation is never meaningful here
    .replace(/\s+/g, ' ')
    .trim()

/** What we actually ask Nominatim, kept close to how people write addresses. */
const queryFor = (a: GeocodableAddress): string =>
  `${a.line1}, ${a.area}, ${a.zone}, ${a.city}, Bangladesh`

interface NominatimRow {
  lat: string
  lon: string
  display_name: string
}

const callNominatim = async (query: string): Promise<NominatimRow | null> => {
  const url = new URL('/search', env.NOMINATIM_BASE_URL ?? 'https://nominatim.openstreetmap.org')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '1')
  // Bangladesh only. Cheaper than filtering afterwards and kinder upstream.
  url.searchParams.set('countrycodes', 'bd')

  const userAgent = env.NOMINATIM_USER_AGENT
  if (!userAgent) {
    // Nominatim 403s anonymous traffic outright, so failing here with a clear
    // message beats a confusing rejection from upstream.
    throw new LookupError(
      'provider_rejected',
      'NOMINATIM_USER_AGENT is not set — Nominatim requires a contact string',
    )
  }

  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': userAgent, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new LookupError('provider_unavailable', 'the geocoder did not respond')
  }

  if (res.status === 429 || res.status === 403) {
    throw new LookupError(
      'provider_rejected',
      'the geocoder refused the request — check the User-Agent and request rate',
    )
  }
  if (!res.ok) {
    throw new LookupError('provider_unavailable', `the geocoder returned ${res.status}`)
  }

  const rows = (await res.json()) as NominatimRow[]
  return rows[0] ?? null
}

/**
 * Resolve one address to a point, using the cache first.
 *
 * Negative results are cached as well: a mistyped street will not start
 * resolving on retry, and without that entry every retry becomes another
 * upstream request against a 1/sec budget.
 */
export const geocodeAddress = async (
  address: GeocodableAddress,
  field?: 'pickup' | 'drop',
): Promise<GeocodedAddress> => {
  const key = normaliseAddress(address)

  const cached = await runAsSystem('geocode: cache read', async () =>
    GeocodeCacheModel.findOne({ key }).lean().exec(),
  )

  if (cached) {
    if (!cached.found || !cached.point) {
      throw new LookupError(
        'address_not_found',
        'we could not find that address — check the road and area',
        field,
      )
    }
    return {
      point: cached.point,
      resolvedLabel: cached.resolvedLabel ?? '',
    }
  }

  const query = queryFor(address)
  const row = await throttle.run(() => callNominatim(query))

  if (!row) {
    await runAsSystem('geocode: cache miss', async () =>
      GeocodeCacheModel.updateOne(
        { key },
        { $set: { query, found: false, lookedUpAt: new Date() } },
        { upsert: true },
      ).exec(),
    )
    throw new LookupError(
      'address_not_found',
      'we could not find that address — check the road and area',
      field,
    )
  }

  const lat = Number(row.lat)
  const lng = Number(row.lon)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new LookupError('provider_unavailable', 'the geocoder returned an unusable result', field)
  }

  if (!withinServiceArea(lng, lat)) {
    // Cached as a miss: the same query will keep resolving outside the area,
    // so there is nothing to gain by asking again.
    await runAsSystem('geocode: outside area', async () =>
      GeocodeCacheModel.updateOne(
        { key },
        { $set: { query, found: false, lookedUpAt: new Date() } },
        { upsert: true },
      ).exec(),
    )
    throw new LookupError(
      'outside_service_area',
      'that address resolved outside Dhaka — we only deliver within the city',
      field,
    )
  }

  const resolved: GeocodedAddress = {
    point: { type: 'Point', coordinates: [lng, lat] },
    resolvedLabel: row.display_name,
  }

  await runAsSystem('geocode: cache write', async () =>
    GeocodeCacheModel.updateOne(
      { key },
      {
        $set: {
          query,
          found: true,
          point: resolved.point,
          resolvedLabel: resolved.resolvedLabel,
          lookedUpAt: new Date(),
        },
      },
      { upsert: true },
    ).exec(),
  )

  return resolved
}

/** Exposed for tests and for logging queue depth under load. */
export const geocodeQueueDepth = (): number => throttle.pending()

/**
 * M9.7: the reverse direction — a position to a readable label, for a
 * rider's GPS tap and the idle background watcher (setting a position via
 * coordinates has no address to echo back the way "type an address" does).
 *
 * Shares this module's own `throttle` singleton (not a second one) so a
 * forward lookup and a reverse one queue together against the same 1/sec
 * ceiling — CLAUDE.md section 2's budget is upstream, not per-direction.
 * Cached in the SAME collection as forward results, under a `rev:` key
 * namespace, rounded to ~11m (4 decimal places) so a stationary idle rider
 * does not re-ask for the same block every 30s tick.
 */
interface NominatimReverseRow {
  lat: string
  lon: string
  display_name: string
  address?: Record<string, string>
  error?: string
}

const reverseKey = (lat: number, lng: number): string =>
  `rev:${lat.toFixed(4)},${lng.toFixed(4)}`

/**
 * Nominatim's `display_name` is a full postal string ("Road 27, Dhanmondi,
 * Dhaka, Dhaka Division, 1209, Bangladesh") — a rider needs "Dhanmondi 27,
 * Dhaka", not that. Built from `address` parts rather than truncating the
 * display name, which would cut mid-word as often as not.
 */
const shortLabel = (row: NominatimReverseRow): string => {
  const a = row.address ?? {}
  const area = a.suburb ?? a.neighbourhood ?? a.city_district ?? a.town ?? a.village
  const primary = [a.road, area].filter(Boolean).join(', ')
  const city = a.city ?? a.state ?? 'Dhaka'
  return primary ? `${primary}, ${city}` : (area ?? row.display_name)
}

const callNominatimReverse = async (
  lat: number,
  lng: number,
): Promise<NominatimReverseRow | null> => {
  const url = new URL('/reverse', env.NOMINATIM_BASE_URL ?? 'https://nominatim.openstreetmap.org')
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lng))
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('zoom', '16')
  url.searchParams.set('addressdetails', '1')

  const userAgent = env.NOMINATIM_USER_AGENT
  if (!userAgent) {
    throw new LookupError(
      'provider_rejected',
      'NOMINATIM_USER_AGENT is not set — Nominatim requires a contact string',
    )
  }

  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': userAgent, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new LookupError('provider_unavailable', 'the geocoder did not respond')
  }

  if (res.status === 429 || res.status === 403) {
    throw new LookupError(
      'provider_rejected',
      'the geocoder refused the request — check the User-Agent and request rate',
    )
  }
  if (!res.ok) {
    throw new LookupError('provider_unavailable', `the geocoder returned ${res.status}`)
  }

  const row = (await res.json()) as NominatimReverseRow
  return row?.error ? null : row
}

/**
 * Best-effort, unlike `geocodeAddress`: a rider's position is already usable
 * for the $near query the moment it is written, so a Nominatim failure here
 * must never fail the request that set it — it only costs the friendly
 * label, and the caller falls back to showing coordinates. Returns `null`
 * rather than throwing for exactly that reason.
 */
export const reverseGeocode = async (point: GeoPoint): Promise<{ label: string } | null> => {
  const [lng, lat] = point.coordinates
  const key = reverseKey(lat, lng)

  const cached = await runAsSystem('geocode: reverse cache read', async () =>
    GeocodeCacheModel.findOne({ key }).lean().exec(),
  )
  if (cached) {
    return cached.found && cached.resolvedLabel ? { label: cached.resolvedLabel } : null
  }

  let row: NominatimReverseRow | null
  try {
    row = await throttle.run(() => callNominatimReverse(lat, lng))
  } catch {
    // Transient (rate-limited, timed out, provider down) — NOT cached as a
    // permanent miss, unlike a genuine "no address here" result below.
    return null
  }

  if (!row) {
    await runAsSystem('geocode: reverse cache miss', async () =>
      GeocodeCacheModel.updateOne(
        { key },
        { $set: { query: `reverse ${lat},${lng}`, found: false, lookedUpAt: new Date() } },
        { upsert: true },
      ).exec(),
    )
    return null
  }

  const label = shortLabel(row)
  await runAsSystem('geocode: reverse cache write', async () =>
    GeocodeCacheModel.updateOne(
      { key },
      {
        $set: {
          query: `reverse ${lat},${lng}`,
          found: true,
          point,
          resolvedLabel: label,
          lookedUpAt: new Date(),
        },
      },
      { upsert: true },
    ).exec(),
  )
  return { label }
}
