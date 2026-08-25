import { useQuery } from '@tanstack/react-query'
import type { PricingSummary } from '@pdms/shared'
import { api } from '@/lib/api'

/**
 * The landing page's stat band — zone count, floor fee, weight cap — from
 * GET /pricing/summary, which needs no session because the landing page
 * does not have one. "Read from real data where cheap" (CLAUDE.md's
 * M6.5c brief): three numbers, one small unauthenticated route, no hard-coded
 * copy that could drift from what PricingConfig actually says.
 */
export const usePublicPricingSummary = () =>
  useQuery({
    queryKey: ['pricing', 'summary'],
    queryFn: () => api.get<PricingSummary>('/pricing/summary'),
    staleTime: 5 * 60_000,
  })
