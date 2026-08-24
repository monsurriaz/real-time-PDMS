import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LoginInput, SelfUser } from '@pdms/shared'
import { ApiError, api } from '@/lib/api'
import { closeSocket } from '@/lib/socket'

interface AuthResponse {
  user: SelfUser
}

export const meQueryKey = ['auth', 'me'] as const

/**
 * The current session, read from the server rather than kept in client state.
 * The token is httpOnly, so the client genuinely cannot know who it is
 * without asking — which is the point, and also means there is no stale copy
 * to invalidate.
 */
export const useMe = () =>
  useQuery({
    queryKey: meQueryKey,
    queryFn: () => api.get<AuthResponse>('/auth/me'),
    select: (d) => d.user,
    /**
     * A 401 is the expected answer for a visitor, not a failure worth
     * retrying — retrying it just delays the login screen.
     */
    retry: (_count, error) =>
      !(error instanceof ApiError && error.isUnauthorized),
    staleTime: 60_000,
  })

export const useLogin = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: LoginInput) =>
      api.post<AuthResponse>('/auth/login', input),
    onSuccess: (data) => {
      // Seed the cache directly: the login response already contains the
      // exact payload /auth/me would return, so refetching it would be a
      // wasted round trip on the most latency-visible screen in the app.
      qc.setQueryData(meQueryKey, data)
    },
  })
}

export const useLogout = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/auth/logout'),
    onSuccess: () => {
      // Drop everything, not just the session: cached parcels and deliveries
      // belong to the account that just signed out.
      qc.clear()
      // Close the socket too, so the next sign-in re-handshakes with the new
      // cookie rather than keeping the old identity's rooms.
      closeSocket()
    },
  })
}
