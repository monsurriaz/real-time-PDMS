import { useQuery } from '@tanstack/react-query'
import type { AnalyticsOverview } from '@pdms/shared'
import { api } from '@/lib/api'

export const analyticsKey = ['analytics'] as const

/**
 * The admin dashboard's figures.
 *
 * Refetched on a slow timer rather than pushed over the socket: nothing here is
 * per-parcel live, and section 6's socket budget is spent on rider positions,
 * which is where immediacy actually matters. A minute-old delayed count is
 * fine; a minute-old rider position is not.
 */
export const useAnalytics = () =>
  useQuery({
    queryKey: analyticsKey,
    queryFn: () => api.get<AnalyticsOverview>('/analytics/overview'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
