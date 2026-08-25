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

const useDecision = (action: 'approve' | 'reject') => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (agentId: string) =>
      api.post<{ approvalStatus: string; at: string }>(`/agents/${agentId}/${action}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: agentRosterKey })
      // The rail's "Riders" count and services/assignment.ts's pool both
      // depend on approvalStatus flipping.
      void qc.invalidateQueries({ queryKey: ['agents', 'counts'] })
    },
  })
}

export const useApproveAgent = () => useDecision('approve')
export const useRejectAgent = () => useDecision('reject')
