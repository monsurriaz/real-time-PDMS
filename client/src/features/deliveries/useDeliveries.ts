import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  DeliveryListItem,
  DeliveryStatus,
  GeoPoint,
  OtpIssued,
  ProofOfDelivery,
  RecordPodInput,
  ZoneName,
} from '@pdms/shared'
import { api } from '@/lib/api'

export const deliveriesKey = ['deliveries'] as const

export const useDeliveries = (
  status?: DeliveryStatus | 'all',
  opts?: { enabled?: boolean },
) =>
  useQuery({
    ...(opts?.enabled === undefined ? {} : { enabled: opts.enabled }),
    queryKey: [...deliveriesKey, status ?? 'all'],
    queryFn: () =>
      api.get<{ deliveries: DeliveryListItem[] }>(
        status && status !== 'all' ? `/deliveries?status=${status}` : '/deliveries',
      ),
    select: (d) => d.deliveries,
  })

export interface Candidate {
  agentId: string
  userId: string
  name: string
  vehicle: string
  zones: ZoneName[]
  distanceMetres: number | null
  /** What this rider is already carrying — shown so the ranking is explicable. */
  activeDeliveries: number
}

export interface CandidatesResponse {
  zone: ZoneName
  hasPickupPoint: boolean
  strategy: 'near' | 'zone-only' | 'none'
  candidates: Candidate[]
}

/** Only fetched when an admin opens the assign panel for one delivery. */
export const useCandidates = (deliveryId: string | null) =>
  useQuery({
    queryKey: ['deliveries', deliveryId, 'candidates'],
    queryFn: () => api.get<CandidatesResponse>(`/deliveries/${deliveryId}/candidates`),
    enabled: deliveryId !== null,
  })

/** Everything that changes a delivery invalidates every delivery list. */
const useDeliveryMutation = <TInput, TResult>(
  fn: (input: TInput) => Promise<TResult>,
) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: deliveriesKey })
      // A cancellation changes what the customer's parcel list shows.
      void qc.invalidateQueries({ queryKey: ['parcels'] })
    },
  })
}

export const useAssign = () =>
  useDeliveryMutation((input: { deliveryId: string; agentId?: string }) =>
    api.post<{
      status: DeliveryStatus
      agent: Candidate
      strategy: string
      reassigned: boolean
    }>(`/deliveries/${input.deliveryId}/assign`, input.agentId ? { agentId: input.agentId } : {}),
  )

/**
 * The target status is a request, not a decision — the server checks it
 * against the transition map and can refuse (CLAUDE.md rule 3).
 */
export const useAdvanceStatus = () =>
  useDeliveryMutation(
    (input: {
      deliveryId: string
      to: DeliveryStatus
      point?: GeoPoint
      note?: string
    }) =>
      api.post<{ status: DeliveryStatus; at: string }>(
        `/deliveries/${input.deliveryId}/status`,
        {
          to: input.to,
          ...(input.point ? { point: input.point } : {}),
          ...(input.note ? { note: input.note } : {}),
        },
      ),
  )

/**
 * Record proof. The payload is the shared discriminated union, so the three
 * methods share one mutation and one invalidation instead of three near-copies.
 *
 * Note what the OTP arm sends: the digits the recipient read out, nothing more.
 * The verdict comes back from the server (CLAUDE.md rule 3 applied to proof as
 * well as to transitions).
 */
export const useRecordPod = () =>
  useDeliveryMutation((input: { deliveryId: string } & RecordPodInput) => {
    const { deliveryId, ...body } = input
    return api.post<{ proofOfDelivery: ProofOfDelivery }>(
      `/deliveries/${deliveryId}/pod`,
      body,
    )
  })

/**
 * Ask the server to issue a delivery code.
 *
 * The response says when it was sent and when it expires — deliberately not the
 * code, which reaches the recipient through the customer's tracking screen.
 * There is nothing here for the rider to read, and that is the design.
 */
export const useIssueOtp = () =>
  useMutation({
    mutationFn: (deliveryId: string) =>
      api.post<{ otp: OtpIssued }>(`/deliveries/${deliveryId}/pod/otp`),
  })

/**
 * The rider's current position, for stamping onto a transition.
 *
 * Best-effort: a denied or unavailable geolocation must not block a rider from
 * advancing a delivery, so this resolves to null rather than rejecting. The
 * server treats `point` as optional for exactly this reason.
 */
export const currentPosition = (): Promise<GeoPoint | null> =>
  new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          type: 'Point',
          coordinates: [pos.coords.longitude, pos.coords.latitude],
        }),
      () => resolve(null),
      { timeout: 5_000, maximumAge: 30_000 },
    )
  })
