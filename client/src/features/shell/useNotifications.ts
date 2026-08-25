import { useQuery } from '@tanstack/react-query'
import type { Notification } from '@pdms/shared'
import { api } from '@/lib/api'

export const notificationsKey = ['notifications'] as const

/**
 * The header bell's data — recent status changes on whatever this actor can
 * see, plus overdue alerts for admins (server-scoped; see
 * routes/notifications.ts). Polled rather than socket-driven: the point of a
 * notification is exactly "something happened while I wasn't looking at a
 * tracking screen", so it can't rely on already being in a `parcel:{id}`
 * room. 30s is far looser than section 6's 3s location cadence — nobody
 * needs a bell to update sub-second.
 */
export const useNotifications = () =>
  useQuery({
    queryKey: notificationsKey,
    queryFn: () => api.get<{ notifications: Notification[] }>('/notifications'),
    select: (d) => d.notifications,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })

const LAST_SEEN_KEY = 'pdms:notifications:lastSeenAt'

/**
 * When this browser last opened the notifications dropdown. There is no
 * server-side "read" state — the server would have to invent a per-user
 * receipt for every notification just to answer a question the client can
 * answer itself by remembering when it last looked. localStorage rather than
 * component state so it survives the reload the header itself unmounts
 * across on every route change (AppShell is not a persistent layout).
 */
export const getLastSeenAt = (): number => {
  try {
    return Number(localStorage.getItem(LAST_SEEN_KEY) ?? 0)
  } catch {
    // A private window or blocked storage: treat every notification as read
    // rather than crash the header over a dot.
    return Date.now()
  }
}

export const markNotificationsSeen = (): void => {
  try {
    localStorage.setItem(LAST_SEEN_KEY, String(Date.now()))
  } catch {
    // Nothing to do if storage is unavailable — the dot just won't clear.
  }
}
