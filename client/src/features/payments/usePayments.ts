import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CheckoutSession,
  CodReconciliationRow,
  PaymentSummary,
  Settlement,
} from '@pdms/shared'
import { api } from '@/lib/api'

export const paymentsKey = ['payments'] as const

/**
 * Whether card payment is available at all. Asked once per session: a missing
 * Stripe key is a deployment fact, not something that changes while someone is
 * booking a parcel.
 */
export const usePaymentConfig = () =>
  useQuery({
    queryKey: [...paymentsKey, 'config'],
    queryFn: () => api.get<{ cardPayments: boolean; provider: string | null }>('/payments/config'),
    staleTime: Number.POSITIVE_INFINITY,
  })

/**
 * Start a hosted checkout and hand back the URL to send the customer to.
 *
 * The amount is not a parameter. It comes from the Payment row the server
 * created at booking, which came from the price snapshot — so there is nothing
 * here a client could get wrong or tamper with.
 */
export const useStartCheckout = () =>
  useMutation({
    mutationFn: (parcelId: string) =>
      api.post<CheckoutSession>(`/payments/parcel/${parcelId}/checkout`),
  })

export const usePayment = (parcelId: string | null) =>
  useQuery({
    queryKey: [...paymentsKey, 'parcel', parcelId],
    queryFn: () => api.get<{ payment: PaymentSummary }>(`/payments/parcel/${parcelId}`),
    select: (d) => d.payment,
    enabled: parcelId !== null,
  })

export interface ReconciliationResponse {
  rows: CodReconciliationRow[]
  totals: { outstanding: number; settled: number; uncollectable: number }
}

export const useCodReconciliation = () =>
  useQuery({
    queryKey: [...paymentsKey, 'reconciliation'],
    queryFn: () => api.get<ReconciliationResponse>('/payments/reconciliation'),
  })

export const useSettlements = (agentId?: string) =>
  useQuery({
    queryKey: [...paymentsKey, 'settlements', agentId ?? 'all'],
    queryFn: () =>
      api.get<{ settlements: Settlement[] }>(
        agentId ? `/payments/settlements?agentId=${agentId}` : '/payments/settlements',
      ),
    select: (d) => d.settlements,
  })

/**
 * Mark a rider's collected cash as handed in.
 *
 * Invalidates the table AND the trail: settling changes both, and a table still
 * showing cash that has been handed in is the one thing this screen must never
 * do.
 */
export const useSettleAgent = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { agentId: string; note?: string }) =>
      api.post<{ settlement: Settlement }>('/payments/settlements', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentsKey })
    },
  })
}
