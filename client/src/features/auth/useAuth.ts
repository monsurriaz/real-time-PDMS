import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  SavedAddress,
  SavedAddressInput,
  SelfUser,
  UpdateAccountInput,
} from '@pdms/shared'
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
     * No client error is worth retrying here. A 401 is the expected answer for
     * a visitor, and a 403 means the account is suspended — retrying either
     * only delays the screen that explains it, three times over.
     */
    retry: (_count, error) =>
      !(error instanceof ApiError && error.status >= 400 && error.status < 500),
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

/**
 * Signup — customer or rider, one mutation for the discriminated union
 * registerInputSchema describes. The response is exactly what login's would
 * be, so the same cache-seeding trick applies: no immediate refetch of
 * /auth/me right after registering.
 */
export const useRegister = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: RegisterInput) =>
      api.post<AuthResponse>('/auth/register', input),
    onSuccess: (data) => {
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

/**
 * The profile's Account tab. A successful save with a changed email carries
 * a freshly re-issued auth cookie (the server sets it; there is nothing for
 * the client to do about the cookie itself), so seeding the cache is enough
 * to keep the UI in step with the new session.
 */
export const useUpdateAccount = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateAccountInput) =>
      api.patch<AuthResponse>('/auth/me', input),
    onSuccess: (data) => {
      qc.setQueryData(meQueryKey, data)
    },
  })
}

/**
 * The one-time welcome has been seen. See WelcomeNotice for why this fires on
 * appearance rather than on dismissal.
 *
 * The response is the refreshed self user, so the cache is seeded from it —
 * there is nothing to refetch just to learn a banner is spent.
 */
export const useDismissWelcome = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<AuthResponse>('/auth/me/welcome'),
    onSuccess: (data) => {
      qc.setQueryData(meQueryKey, data)
    },
  })
}

/**
 * The profile's "Change photo" (M9.6). The upload itself already happened
 * browser -> Cloudinary before this fires — this is just handing the server
 * the URL it got back, the same cache-seeding shape login/register/welcome
 * already use.
 */
export const useUploadAvatar = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (avatarUrl: string) =>
      api.patch<AuthResponse>('/auth/me/avatar', { avatarUrl }),
    onSuccess: (data) => {
      qc.setQueryData(meQueryKey, data)
    },
  })
}

/** "Remove" — clears the photo. The Cloudinary asset itself is orphaned, not
 *  deleted (no API secret to delete with); see DEFERRED.md. */
export const useRemoveAvatar = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete<AuthResponse>('/auth/me/avatar'),
    onSuccess: (data) => {
      qc.setQueryData(meQueryKey, data)
    },
  })
}

/** The Password tab — its own mutation, its own Save button. */
export const useChangePassword = () =>
  useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      api.patch<{ ok: true }>('/auth/me/password', input),
  })

const addressesKey = ['auth', 'me', 'addresses'] as const

export const useSavedAddresses = () =>
  useQuery({
    queryKey: addressesKey,
    queryFn: () => api.get<{ addresses: SavedAddress[] }>('/auth/me/addresses'),
    select: (d) => d.addresses,
  })

export const useAddSavedAddress = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SavedAddressInput) =>
      api.post<{ addresses: SavedAddress[] }>('/auth/me/addresses', input),
    onSuccess: (data) => qc.setQueryData(addressesKey, data),
  })
}

/** Correct one field without deleting and retyping the whole address. */
export const useUpdateSavedAddress = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ addressId, input }: { addressId: string; input: SavedAddressInput }) =>
      api.patch<{ addresses: SavedAddress[] }>(`/auth/me/addresses/${addressId}`, input),
    onSuccess: (data) => qc.setQueryData(addressesKey, data),
  })
}

export const useDeleteSavedAddress = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (addressId: string) =>
      api.delete<{ addresses: SavedAddress[] }>(`/auth/me/addresses/${addressId}`),
    onSuccess: (data) => qc.setQueryData(addressesKey, data),
  })
}
