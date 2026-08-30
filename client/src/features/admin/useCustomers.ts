import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CustomerRow } from '@pdms/shared'
import { api } from '@/lib/api'

export const customerRosterKey = ['customers', 'roster'] as const

/**
 * Every customer, with their parcel count and account status. One request for
 * the whole list — AdminCustomersPage filters and pages it, the same shape
 * /admin/agents uses for the rider roster.
 */
export const useCustomerRoster = () =>
  useQuery({
    queryKey: customerRosterKey,
    queryFn: () => api.get<{ customers: CustomerRow[] }>('/customers'),
    select: (d) => d.customers,
  })

const useDecision = (action: 'suspend' | 'reactivate') => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (customerId: string) =>
      api.post<{ status: string; at: string }>(`/customers/${customerId}/${action}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: customerRosterKey })
    },
  })
}

export const useSuspendCustomer = () => useDecision('suspend')
export const useReactivateCustomer = () => useDecision('reactivate')

/**
 * Admin photo moderation (M9.6) — a separate, lesser action from
 * suspend/reactivate above, so its own mutation rather than folded into
 * `useDecision`'s shape (that helper's callers all read back `status`; this
 * one reads back `avatarUrl`).
 */
export const useClearCustomerAvatar = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (customerId: string) =>
      api.post<{ avatarUrl: null; at: string }>(`/customers/${customerId}/clear-avatar`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: customerRosterKey })
    },
  })
}
