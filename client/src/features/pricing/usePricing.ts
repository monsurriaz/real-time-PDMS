import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  PriceBreakdown,
  PricingConfigInput,
  ZoneName,
} from '@pdms/shared'
import { api } from '@/lib/api'

interface PricingResponse {
  pricing: PricingConfigInput & { updatedAt: string }
}

export const pricingKey = ['pricing'] as const
export const zonesKey = ['zones'] as const

export const usePricing = () =>
  useQuery({
    queryKey: pricingKey,
    queryFn: () => api.get<PricingResponse>('/pricing'),
    select: (d) => d.pricing,
  })

export const useSavePricing = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: PricingConfigInput) =>
      api.put<PricingResponse>('/pricing', input),
    onSuccess: (data) => {
      qc.setQueryData(pricingKey, data)
      // A rate change moves every future quote, so anything derived from it
      // is now stale.
      void qc.invalidateQueries({ queryKey: ['pricing', 'example'] })
    },
  })
}

interface ZonesResponse {
  zones: Array<{
    name: ZoneName
    label: string
    baseFare: number
    centre: { type: 'Point'; coordinates: [number, number] }
  }>
}

export const useZones = () =>
  useQuery({
    queryKey: zonesKey,
    queryFn: () => api.get<ZonesResponse>('/zones'),
    select: (d) => d.zones,
    // Reference data; it does not change during a session.
    staleTime: 30 * 60_000,
  })

export interface ExampleArgs {
  distanceKm: number
  weightKg: number
  zone?: ZoneName
}

/**
 * The SAVED config's worked example — GET /pricing/example, `requireAuth`
 * only (any role, not just admin, unlike `/preview` below). This is what the
 * booking form's progressive price panel reads: a real server computation
 * from the live rates, using `distanceKm: 0` until Get price runs the real
 * geocode + route lookup. `zoneBase` and `weightTierLabel`/`weightSurcharge`
 * from that response are real numbers safe to show as they become known;
 * `distanceCost` and `total` are NOT — both are pinned to a 0km distance and
 * would misreport what a real quote costs, so the caller must not display
 * them from this hook. See BookingPage's own note on this split.
 */
export const usePriceExample = (args: ExampleArgs | null) =>
  useQuery({
    queryKey: ['pricing', 'example', args],
    queryFn: () => {
      const a = args as ExampleArgs
      const params = new URLSearchParams({
        distanceKm: String(a.distanceKm),
        weightKg: String(a.weightKg),
      })
      if (a.zone) params.set('zone', a.zone)
      return api.get<{ price: PriceBreakdown }>(`/pricing/example?${params.toString()}`)
    },
    select: (d) => d.price,
    enabled: args !== null,
    // An in-progress weight/zone is an expected transient state, not a fault.
    retry: false,
  })

export interface PreviewArgs extends PricingConfigInput {
  distanceKm: number
  weightKg: number
  zone?: ZoneName
}

/**
 * The admin's live worked example, computed from the rates being TYPED.
 *
 * Deliberately a server call rather than a local calculation: CLAUDE.md
 * section 5 asks for a worked example, and reimplementing the formula here
 * would create a second version free to drift from the one that prices real
 * bookings. The draft is posted so the preview tracks unsaved edits.
 */
export const usePricePreview = (draft: PreviewArgs | null) =>
  useQuery({
    // The draft itself is the cache key: any edit produces a new key and
    // therefore a fresh preview, with identical drafts served from cache.
    queryKey: ['pricing', 'example', draft],
    queryFn: () => api.post<{ price: PriceBreakdown }>('/pricing/preview', draft),
    select: (d) => d.price,
    enabled: draft !== null,
    // An invalid draft is an expected state while typing, not a fault.
    retry: false,
  })
