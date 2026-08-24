import { z } from 'zod'
import { geoPoint } from './common'

/**
 * Why a geocode or a distance lookup failed, in terms the booking form can
 * act on. The client needs to tell "we couldn't find that address" (fix the
 * address) apart from "the service is down" (try again shortly) — a single
 * opaque 500 makes both look like the customer's fault.
 */
export const lookupFailureSchema = z.enum([
  /** Nominatim returned zero results for the address as written. */
  'address_not_found',
  /** The address resolved, but to a point outside the serviceable area. */
  'outside_service_area',
  /** No drivable route between the two points. */
  'no_route',
  /** Upstream refused us: rate limit, blocked User-Agent, bad key. */
  'provider_rejected',
  /** Upstream timed out or errored. Retrying may work. */
  'provider_unavailable',
])
export type LookupFailure = z.infer<typeof lookupFailureSchema>

/** Whether a failure is worth retrying, which decides the UI's affordance. */
export const RETRYABLE: readonly LookupFailure[] = [
  'provider_rejected',
  'provider_unavailable',
]

export const geocodedAddressSchema = z.object({
  point: geoPoint,
  /** Nominatim's canonical label, shown back to the customer to confirm. */
  resolvedLabel: z.string(),
})
export type GeocodedAddress = z.infer<typeof geocodedAddressSchema>
