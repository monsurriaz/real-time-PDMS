import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AgentRosterItem } from '@pdms/shared'
import { api } from '@/lib/api'

export const agentRosterKey = ['agents', 'roster'] as const

/** Every agent, pending applications and the approved/rejected roster alike
 *  — AdminAgentsPage buckets this one list by approvalStatus. */
export const useAgentRoster = () =>
  useQuery({
    queryKey: agentRosterKey,
    queryFn: () => api.get<{ agents: AgentRosterItem[] }>('/agents'),
    select: (d) => d.agents,
  })

const useDecision = (action: 'approve' | 'reject' | 'suspend' | 'reactivate') => {
  const qc = useQueryClient()
  return useMutation({
    // Approve/reject reply with `approvalStatus`, suspend/reactivate with
    // `status` — nothing here reads either field back, only `at`, which
    // both share.
    mutationFn: (agentId: string) => api.post<{ at: string }>(`/agents/${agentId}/${action}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: agentRosterKey })
      // The rail's "Riders" count and services/assignment.ts's pool both
      // depend on approvalStatus/accountStatus flipping.
      void qc.invalidateQueries({ queryKey: ['agents', 'counts'] })
    },
  })
}

export const useApproveAgent = () => useDecision('approve')
export const useRejectAgent = () => useDecision('reject')

/**
 * M9: suspend/reactivate the rider's ACCOUNT (User.status), not their
 * application — same generic shape as approve/reject above, and as
 * useCustomers.ts's own useDecision for the same reason: this is the same
 * kind of work as those two, so it should be the same kind of code.
 */
export const useSuspendAgent = () => useDecision('suspend')
export const useReactivateAgent = () => useDecision('reactivate')
