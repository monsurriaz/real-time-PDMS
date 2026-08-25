import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AgentSelf,
  SetAgentLocationInput,
  SetAgentStatusInput,
  UpdateAgentDetailsInput,
} from '@pdms/shared'
import { api } from '@/lib/api'
import { deliveriesKey } from '../deliveries/useDeliveries'

export const agentSelfKey = ['agent', 'me'] as const

/**
 * `enabled` matters here specifically because RequireRole calls this for the
 * approval gate (see roles it wraps around every agent route, including
 * /agent/pending) — it must not fire this request for a customer or admin
 * route just because the same generic component happens to render there.
 */
export const useAgentSelf = (opts?: { enabled?: boolean }) =>
  useQuery({
    queryKey: agentSelfKey,
    queryFn: () => api.get<{ agent: AgentSelf }>('/agents/me'),
    select: (d) => d.agent,
    ...(opts?.enabled === undefined ? {} : { enabled: opts.enabled }),
  })

const useAgentMutation = <T>(
  path: string,
  method: 'post' | 'patch' = 'post',
) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: T) => api[method]<{ agent: AgentSelf }>(path, input),
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

/** The agent profile's Rider details tab — vehicle and covered zones. */
export const useUpdateAgentDetails = () =>
  useAgentMutation<UpdateAgentDetailsInput>('/agents/me/details', 'patch')
