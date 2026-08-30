import { useEffect, useRef } from 'react'
import { LOCATION_PERSIST_INTERVAL_MS } from '@pdms/shared'
import { setLocationWatcherState } from './locationWatcherStore'
import { useSetLocation } from './useAgentSelf'

/**
 * M9.7 tier 1's "PLUS a background watcher": while an on-shift rider has no
 * active delivery, keep `Agent.currentLocation` current on its own, without
 * a tap every time proximity assignment needs somewhere real to look.
 *
 * `active` is exactly `agent.status === 'available'` — that one enum value
 * already means "on shift AND not carrying a delivery" (the system sets
 * `on_delivery` itself the moment work is picked up, per routes/agents.ts's
 * own note), so there is no second "has an active delivery" check to get out
 * of sync with it.
 *
 * Mounted once, from ShiftRail — which renders exactly once per page, for
 * every agent route, via AppShell — not from ShiftEditor, which renders
 * TWICE (the rail's popover AND the profile's Rider details tab). A second
 * `watchPosition` per open surface would mean two independent throttles
 * racing each other over the same field.
 *
 * Idle only, by construction: the socket's own `location:update` handler
 * already persists `Agent.currentLocation` from the live GPS stream, on the
 * same 30s cadence, but ONLY while `agentOwnsDelivery` finds an Accepted /
 * PickedUp / InTransit delivery (server/src/sockets/index.ts). Gating this
 * watcher on `available` means it and the socket handler are never both
 * writing at once — two writers on one field, which CLAUDE.md section 6's
 * whole throttle design exists to avoid.
 */
export const useIdleLocationWatcher = (active: boolean): void => {
  const setLocation = useSetLocation()
  const mutateRef = useRef(setLocation.mutate)
  mutateRef.current = setLocation.mutate
  const lastSentAt = useRef(0)

  useEffect(() => {
    if (!active) {
      setLocationWatcherState({ isWatching: false })
      return
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationWatcherState({ isWatching: false })
      return
    }

    lastSentAt.current = 0

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setLocationWatcherState({ isWatching: true, permissionDenied: false })
        const now = Date.now()
        // Reuses section 6's own persist cadence (LOCATION_PERSIST_INTERVAL_MS,
        // 30s) rather than a second, unrelated interval — the free-tier
        // reasoning behind that number does not change because the writer did.
        if (now - lastSentAt.current < LOCATION_PERSIST_INTERVAL_MS) return
        lastSentAt.current = now
        mutateRef.current({
          mode: 'coords',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        })
      },
      (err) => {
        // Denied or unavailable: stop cleanly rather than retrying into the
        // same rejection. A rider who declines GPS still has tiers 2 and 3.
        setLocationWatcherState({
          isWatching: false,
          permissionDenied: err.code === err.PERMISSION_DENIED,
        })
      },
      { enableHighAccuracy: false, maximumAge: 20_000, timeout: 15_000 },
    )

    return () => {
      navigator.geolocation.clearWatch(id)
      setLocationWatcherState({ isWatching: false })
    }
  }, [active])
}
