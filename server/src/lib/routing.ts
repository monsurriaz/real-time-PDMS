import type { GeoPoint } from '@pdms/shared'
import { RouteCacheModel } from '../models/RouteCache'
import { runAsSystem } from './context'
import { env } from './env'
import { LookupError } from './lookupError'
import { createThrottle } from './throttle'

/**
 * OpenRouteService, wrapped for road distance. CLAUDE.md section 5 takes
 * distance from ORS and caches it per address pair.
 *
 * The free tier allows roughly 40 requests/minute, so this is throttled far
 * more loosely than Nominatim — but still throttled, because the seed script
 * asks for twenty routes in a burst.
 */

const ORS_MIN_INTERVAL_MS = 1_600 // ~37/min, inside the free tier
const REQUEST_TIMEOUT_MS = 15_000

const throttle = createThrottle(ORS_MIN_INTERVAL_MS)

export interface RouteResult {
  distanceKm: number
  durationMin: number
}

/**
 * Five decimals is about a metre. Rounding keeps floating-point noise from
 * producing near-duplicate cache rows for what is really one address pair.
 */
const coordKey = (p: GeoPoint): string =>
  `${p.coordinates[0].toFixed(5)},${p.coordinates[1].toFixed(5)}`

const cacheKey = (from: GeoPoint, to: GeoPoint): string =>
  `${coordKey(from)}|${coordKey(to)}`

interface OrsResponse {
  routes?: Array<{ summary?: { distance?: number; duration?: number } }>
  error?: unknown
}

const callOrs = async (from: GeoPoint, to: GeoPoint): Promise<RouteResult> => {
  if (!env.ORS_API_KEY) {
    throw new LookupError(
      'provider_rejected',
      'ORS_API_KEY is not set — distance cannot be calculated',
    )
  }

  let res: Response
  try {
    res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: {
        Authorization: env.ORS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ coordinates: [from.coordinates, to.coordinates] }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new LookupError('provider_unavailable', 'the routing service did not respond')
  }

  if (res.status === 401 || res.status === 403) {
    throw new LookupError('provider_rejected', 'the routing service rejected our API key')
  }
  if (res.status === 429) {
    throw new LookupError('provider_rejected', 'routing rate limit reached — try again shortly')
  }

  const body = (await res.json()) as OrsResponse

  if (!res.ok) {
    /**
     * ORS reports "no route found" as a 404 with an error body rather than an
     * empty result. That is the customer's problem to fix (usually an address
     * on an island or across water), not a transient fault, so it must not be
     * presented as retryable.
     */
    if (res.status === 404) {
      throw new LookupError('no_route', 'we could not find a road route between those addresses')
    }
    throw new LookupError('provider_unavailable', `the routing service returned ${res.status}`)
  }

  const summary = body.routes?.[0]?.summary
  if (!summary || typeof summary.distance !== 'number') {
    throw new LookupError('no_route', 'we could not find a road route between those addresses')
  }

  return {
    distanceKm: summary.distance / 1000,
    durationMin: (summary.duration ?? 0) / 60,
  }
}

/** Road distance between two geocoded points, cached per pair. */
export const routeBetween = async (
  from: GeoPoint,
  to: GeoPoint,
): Promise<RouteResult> => {
  const key = cacheKey(from, to)

  const cached = await runAsSystem('routing: cache read', async () =>
    RouteCacheModel.findOne({ key }).lean().exec(),
  )
  if (cached) {
    return { distanceKm: cached.distanceKm, durationMin: cached.durationMin }
  }

  const result = await throttle.run(() => callOrs(from, to))

  await runAsSystem('routing: cache write', async () =>
    RouteCacheModel.updateOne(
      { key },
      {
        $set: {
          distanceKm: result.distanceKm,
          durationMin: result.durationMin,
          lookedUpAt: new Date(),
        },
      },
      { upsert: true },
    ).exec(),
  )

  return result
}

export const routingQueueDepth = (): number => throttle.pending()
