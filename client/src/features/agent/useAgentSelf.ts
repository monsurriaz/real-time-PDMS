import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AgentSelf,
  SetAgentLocationInput,
  SetAgentStatusInput,
} from '@pdms/shared'
import { api } from '@/lib/api'
import { deliveriesKey } from '../deliveries/useDeliveries'

export const agentSelfKey = ['agent', 'me'] as const

export const useAgentSelf = () =>
  useQuery({
    queryKey: agentSelfKey,
    queryFn: () => api.get<{ agent: AgentSelf }>('/agents/me'),
    select: (d) => d.agent,
  })

const useAgentMutation = <T>(path: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: T) => api.post<{ agent: AgentSelf }>(path, input),
    onSuccess: (data) => {
      qc.setQueryData(agentSelfKey, data)
      /**
       * Availability and position both feed the $near assignment query, so
       * either change can produce new work for this rider — refresh the run
       * list rather than waiting for the next poll.
       */
      void qc.invalidateQueries({ queryKey: deliveriesKey })
    },
  })
}

export const useSetLocation = () =>
  useAgentMutation<SetAgentLocationInput>('/agents/me/location')

export const useSetAgentStatus = () =>
  useAgentMutation<SetAgentStatusInput>('/agents/me/status')
