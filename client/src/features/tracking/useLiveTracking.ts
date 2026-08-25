import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  MAX_LOCATION_HISTORY,
  REST_POLL_INTERVAL_MS,
  SOCKET_EVENTS,
  type ConnectionMode,
  type DeliveryEvent,
  type DeliveryStatus,
  type GeoPoint,
  type LocationBroadcast,
  type ProofOfDelivery,
  type StatusChanged,
} from '@pdms/shared'
import { ApiError, api } from '@/lib/api'
import { getSocket, joinParcelRoom, leaveParcelRoom, modeFor } from '@/lib/socket'
import { useMe } from '../auth/useAuth'

export interface TrackingSnapshot {
  parcel: {
    _id: string
    trackingId: string
    pickup: { area: string; zone: string; point: GeoPoint | null }
    drop: { area: string; zone: string; recipientName: string; point: GeoPoint | null }
    weightKg: number
    isCod: boolean
    codAmount: number
    total: number
    createdAt: string
  }
  delivery: {
    _id: string
    status: DeliveryStatus
    events: DeliveryEvent[]
    lastKnownLocation: GeoPoint | null
    lastLocationAt: string | null
    expectedBy: string | null
    hasProofOfDelivery: boolean
    proofOfDelivery: ProofOfDelivery | null
  }
  /**
   * The delivery code the rider asked for, when one is outstanding.
   *
   * Present for the parcel's owner and for an admin, and absent for the rider —
   * the server decides that, because the code exists to prove the rider reached
   * the recipient. There is no SMS provider in this project, so this screen is
   * the channel: the sender reads the code out over the phone.
   */
  otp: { code: string; expiresAt: string } | null
  rider: { name: string; vehicle: string; currentLocation?: GeoPoint } | null
  route: Array<[number, number]>
}

export const trackingKey = (parcelId: string) => ['tracking', parcelId] as const

/**
 * Live tracking for one parcel (CLAUDE.md section 6).
 *
 * Socket first: join parcel:{id}, take positions as they arrive. If the socket
 * drops, REST polling every 10 seconds takes over so tracking keeps working
 * with reduced immediacy — and `mode` says which is happening, because a stale
 * position that looks current is worse than an honest "reconnecting".
 *
 * History is capped at 200 points per session, per section 6.
 */
export const useLiveTracking = (parcelId: string | undefined) => {
  const qc = useQueryClient()
  const [mode, setMode] = useState<ConnectionMode>('connecting')
  const [history, setHistory] = useState<GeoPoint[]>([])
  const [livePoint, setLivePoint] = useState<GeoPoint | null>(null)
  const [lastTickAt, setLastTickAt] = useState<Date | null>(null)

  const everConnected = useRef(false)
  const pollingWorks = useRef(true)

  /**
   * The snapshot, and the REST fallback in one. `refetchInterval` comes on only
   * while the socket is down — polling a healthy socket is the waste section 6
   * is trying to avoid — and only while there is a session to poll with.
   *
   * Signing out closes the socket, which fires the disconnect handler below and
   * flips `mode` to 'polling' — which would then poll /tracking/:id with a
   * cookie that no longer exists, producing 401s in the console on the way to
   * the login screen. Gating on the session stops that at the source rather
   * than filtering the errors afterwards.
   */
  const me = useMe()
  const signedIn = Boolean(me.data)

  const snapshot = useQuery({
    queryKey: parcelId ? trackingKey(parcelId) : ['tracking', 'none'],
    queryFn: () => api.get<TrackingSnapshot>(`/tracking/${parcelId}`),
    enabled: Boolean(parcelId) && signedIn,
    refetchInterval:
      signedIn && (mode === 'polling' || mode === 'offline')
        ? REST_POLL_INTERVAL_MS
        : false,
    refetchIntervalInBackground: false,
    // A 401 means the session is gone, not that the server is unwell — retrying
    // would just repeat the console error.
    retry: (count, error) =>
      !(error instanceof ApiError && error.isUnauthorized) && count < 2,
  })

  // Track whether polling itself is succeeding, so 'offline' is honest.
  useEffect(() => {
    if (snapshot.isSuccess) pollingWorks.current = true
    if (snapshot.isError) pollingWorks.current = false
  }, [snapshot.isSuccess, snapshot.isError])

  /**
   * Seed the trail from the persisted position so a page load mid-journey
   * shows the rider somewhere sensible rather than nowhere.
   */
  useEffect(() => {
    const persisted = snapshot.data?.delivery.lastKnownLocation
    if (!persisted) return
    setLivePoint((current) => current ?? persisted)
    setHistory((h) => (h.length === 0 ? [persisted] : h))
  }, [snapshot.data?.delivery.lastKnownLocation])

  useEffect(() => {
    // No session, no socket: the handshake would be refused anyway.
    if (!parcelId || !signedIn) return

    const socket = getSocket()
    let cancelled = false

    const syncMode = (): void => {
      if (cancelled) return
      setMode(modeFor(socket.connected, everConnected.current, pollingWorks.current))
    }

    const onConnect = (): void => {
      everConnected.current = true
      void joinParcelRoom(parcelId).then(() => {
        if (!cancelled) syncMode()
      })
      syncMode()
    }

    const onDisconnect = (): void => {
      // Falls through to polling; socket.io retries the connection itself.
      syncMode()
    }

    const onLocation = (raw: LocationBroadcast): void => {
      if (cancelled || raw.deliveryId !== snapshot.data?.delivery._id) return
      setLivePoint(raw.point)
      setLastTickAt(new Date(raw.at))
      setHistory((h) => {
        const next = [...h, raw.point]
        // Section 6: cap retained history at 200 points per session.
        return next.length > MAX_LOCATION_HISTORY
          ? next.slice(next.length - MAX_LOCATION_HISTORY)
          : next
      })
    }

    const onStatus = (raw: StatusChanged): void => {
      if (cancelled) return
      // The lifecycle moved: re-read rather than patching state by hand, so
      // the screen cannot drift from what the server actually holds.
      void qc.invalidateQueries({ queryKey: trackingKey(parcelId) })
      void qc.invalidateQueries({ queryKey: ['deliveries'] })
      void qc.invalidateQueries({ queryKey: ['parcels'] })
      if (raw.status === 'Delivered' || raw.status === 'Failed') {
        setLastTickAt(null)
      }
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on(SOCKET_EVENTS.locationBroadcast, onLocation)
    socket.on(SOCKET_EVENTS.statusChanged, onStatus)

    if (socket.connected) onConnect()
    else {
      socket.connect()
      syncMode()
    }

    return () => {
      cancelled = true
      leaveParcelRoom(parcelId)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off(SOCKET_EVENTS.locationBroadcast, onLocation)
      socket.off(SOCKET_EVENTS.statusChanged, onStatus)
    }
  }, [parcelId, signedIn, snapshot.data?.delivery._id, qc])

  /**
   * While polling, the freshest thing available is the persisted position —
   * up to 30 seconds old by design (section 6's write throttle). Preferring it
   * over a socket point that stopped arriving is what keeps the map honest.
   */
  const pollingPoint = snapshot.data?.delivery.lastKnownLocation ?? null
  const point = mode === 'live' ? (livePoint ?? pollingPoint) : (pollingPoint ?? livePoint)

  return {
    snapshot,
    mode,
    /** The position to draw. */
    point,
    /**
     * Every position received this session, capped at 200 points (section
     * 6). No longer fed into the map as its own line — the v3.1 addendum's
     * fix for the route rendering bug is to split the PLANNED route at the
     * rider's current position (TrackingMap's `splitRouteByProgress`),
     * which needs only `point`, not a raw history of past ones. Kept here
     * because the accumulate-and-cap behaviour is section 6's own rule, not
     * something that exists only to feed a map layer, and a played-back
     * "where this rider actually went" view is the obvious thing to build on
     * it later.
     */
    history,
    /** When the last socket tick arrived; null while polling. */
    lastTickAt: mode === 'live' ? lastTickAt : null,
  }
}
