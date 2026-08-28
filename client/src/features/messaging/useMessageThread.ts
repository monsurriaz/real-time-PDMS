import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  SOCKET_EVENTS,
  type MessageBroadcast,
  type MessageThread,
  type PostMessageInput,
} from '@pdms/shared'
import { api } from '@/lib/api'
import { getSocket, joinParcelRoom, leaveParcelRoom } from '@/lib/socket'

/**
 * Customer <-> rider chat for one delivery (M9).
 *
 * Reuses the parcel:{id} socket room and its existing join authorisation —
 * this hook is the one thing that newly joins that room on the rider's side
 * (a rider previously had no reason to be IN the room, only to publish
 * location ticks into it); nothing server-side changes to allow it, since
 * mayJoin never restricted by role in the first place.
 *
 * A new socket event re-fetches the thread rather than patching state by
 * hand, the same choice useLiveTracking makes for status:changed — simpler,
 * and the screen can never drift from what the server actually holds.
 */

export const messageThreadKey = (deliveryId: string) => ['messages', deliveryId] as const

export const useMessageThread = (deliveryId: string | null, parcelId: string | null) => {
  const qc = useQueryClient()

  const thread = useQuery({
    queryKey: deliveryId ? messageThreadKey(deliveryId) : ['messages', 'none'],
    queryFn: () => api.get<MessageThread>(`/messages/${deliveryId}`),
    enabled: Boolean(deliveryId),
  })

  useEffect(() => {
    if (!deliveryId || !parcelId) return
    const socket = getSocket()
    let cancelled = false

    void joinParcelRoom(parcelId)

    const onMessage = (raw: MessageBroadcast): void => {
      if (cancelled || raw.delivery !== deliveryId) return
      void qc.invalidateQueries({ queryKey: messageThreadKey(deliveryId) })
    }
    socket.on(SOCKET_EVENTS.messageNew, onMessage)

    return () => {
      cancelled = true
      socket.off(SOCKET_EVENTS.messageNew, onMessage)
      leaveParcelRoom(parcelId)
    }
  }, [deliveryId, parcelId, qc])

  return thread
}

export const usePostMessage = (deliveryId: string | null) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: PostMessageInput) => {
      if (!deliveryId) throw new Error('no delivery selected')
      return api.post<{ message: unknown }>(`/messages/${deliveryId}`, input)
    },
    onSuccess: () => {
      if (deliveryId) void qc.invalidateQueries({ queryKey: messageThreadKey(deliveryId) })
    },
  })
}
