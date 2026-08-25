import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { TrackingSnapshot } from '../tracking/useLiveTracking'

/**
 * Pickup, drop and the cached road line for one delivery's compact map on the
 * rider's own workspace.
 *
 * Deliberately NOT useLiveTracking: that hook exists to watch a MOVING rider
 * from the outside — socket join, glide animation, REST fallback — which is
 * the customer's problem, not the rider's. A rider always knows where they
 * are. A plain, scoped fetch of the same `/tracking/:parcelId` endpoint gives
 * the map its pickup pin, drop pin and route geometry with none of that
 * machinery — the endpoint is already scoped to the rider's own assignments
 * (ParcelModel's roleScope), so this needs no server change.
 */
export const useDeliveryRoute = (parcelId: string | undefined) =>
  useQuery({
    queryKey: ['tracking', parcelId, 'route'],
    queryFn: () => api.get<TrackingSnapshot>(`/tracking/${parcelId}`),
    enabled: Boolean(parcelId),
    staleTime: 60_000,
  })
