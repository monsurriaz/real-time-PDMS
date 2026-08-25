import { useQuery } from '@tanstack/react-query'
import type { PublicTrackingSnapshot } from '@pdms/shared'
import { ApiError, api } from '@/lib/api'

/**
 * GET /tracking/by-id/:trackingId — no session, no requireAuth. Polling
 * rather than a socket join: this page has no authenticated actor to
 * authorise a room join with, and a stranger checking a tracking ID every
 * ten seconds is exactly the load the REST fallback in CLAUDE.md section 6
 * was already sized for.
 */
export const usePublicTracking = (trackingId: string) =>
  useQuery({
    queryKey: ['tracking', 'public', trackingId],
    queryFn: () => api.get<PublicTrackingSnapshot>(`/tracking/by-id/${trackingId}`),
    enabled: trackingId.length > 0,
    refetchInterval: 10_000,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  })
