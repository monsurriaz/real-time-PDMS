import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  BookParcelInput,
  LookupFailure,
  ParcelListItem,
  PriceBreakdown,
} from '@pdms/shared'
import { ApiError, api } from '@/lib/api'

export const parcelsKey = ['parcels'] as const

export interface QuoteResult {
  price: PriceBreakdown
  pickup: { resolvedLabel: string }
  drop: { resolvedLabel: string }
}

/**
 * Fired on demand, not as the customer types. Geocoding goes through
 * Nominatim's 1 req/sec budget (CLAUDE.md section 2), so a keystroke-driven
 * quote would queue up dozens of requests for addresses nobody submitted.
 */
export const useQuote = () =>
  useMutation({
    mutationFn: (input: BookParcelInput) =>
      api.post<QuoteResult>('/parcels/quote', input),
  })

interface BookResult {
  parcel: { _id: string; trackingId: string; price: PriceBreakdown }
}

export const useBookParcel = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BookParcelInput) =>
      api.post<BookResult>('/parcels', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: parcelsKey })
    },
  })
}

export const useParcels = () =>
  useQuery({
    queryKey: parcelsKey,
    queryFn: () => api.get<{ parcels: ParcelListItem[] }>('/parcels'),
    select: (d) => d.parcels,
  })

/**
 * The server's lookup errors carry `reason`, `field` and `retryable` so the
 * form can point at the offending address and offer the right next step.
 * Reading them off ApiError.details is not possible — they are top-level — so
 * this narrows the response body instead.
 */
export interface LookupProblem {
  message: string
  reason?: LookupFailure
  field?: 'pickup' | 'drop'
  retryable: boolean
}

export const asLookupProblem = (err: unknown): LookupProblem | null => {
  if (!(err instanceof ApiError)) return null
  const body = err.body as
    | { reason?: LookupFailure; field?: 'pickup' | 'drop'; retryable?: boolean }
    | undefined
  if (!body?.reason) return null
  return {
    message: err.message,
    reason: body.reason,
    field: body.field,
    retryable: body.retryable === true,
  }
}
