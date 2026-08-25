import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  REST_POLL_INTERVAL_MS,
  SOCKET_EVENTS,
  type AgentStatus,
  type ConnectionMode,
  type GeoPoint,
  type LocationBroadcast,
  type StatusChanged,
} from '@pdms/shared'
import { Card } from '@/components/Card'
import { LazyTrackingMap } from '@/components/LazyTrackingMap'
import type { MapRider } from '@/components/TrackingMap'
import { ApiError, api } from '@/lib/api'
import { getSocket, joinParcelRoom, modeFor } from '@/lib/socket'
import { ConnectionPill } from '../tracking/ConnectionPill'

/**
 * Every on-shift rider on one map (M4, rebuilt M6.98).
 *
 * Sourced from Agent directly, not from active delivery rooms — the old
 * version joined every ACTIVE DELIVERY's room and drew one marker per row it
 * got back, so a rider holding zero deliveries (the entire point of "who is
 * idle and could take a job") never appeared at all. Every available or
 * on_delivery agent with a known position is a row here regardless of
 * whether they are carrying anything; offline agents show nowhere, since
 * there is no meaningful position to show for someone not on shift.
 *
 * Live positions still arrive over the same socket the customer screen
 * uses — one room per active PARCEL, joined only for busy riders' actual
 * runs, since an idle rider has no delivery room to join in the first place.
 * When the socket is down the same REST endpoint polls every 10s.
 */

interface FleetDelivery {
  deliveryId: string
  parcelId: string
  trackingId: string
}

interface FleetAgent {
  agentId: string
  agentName: string
  status: AgentStatus
  point: GeoPoint
  at: string | null
  deliveries: FleetDelivery[]
}

const fleetKey = ['tracking', 'fleet'] as const

export const FleetMap = () => {
  const qc = useQueryClient()
  const [mode, setMode] = useState<ConnectionMode>('connecting')
  const [livePoints, setLivePoints] = useState<Record<string, GeoPoint>>({})

  const fleet = useQuery({
    queryKey: fleetKey,
    queryFn: () => api.get<{ riders: FleetAgent[] }>('/tracking/active/positions'),
    select: (d) => d.riders,
    refetchInterval:
      mode === 'polling' || mode === 'offline' ? REST_POLL_INTERVAL_MS : false,
  })

  /** Every busy rider's delivery id resolves back to the agent it belongs to
   * — location:broadcast only ever carries a deliveryId, so this is how a
   * live tick finds its way back to the right marker. */
  const agentByDelivery = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of fleet.data ?? []) {
      for (const d of r.deliveries) m.set(d.deliveryId, r.agentId)
    }
    return m
  }, [fleet.data])

  // ---- join every busy rider's active run(s) ----
  useEffect(() => {
    const socket = getSocket()
    let cancelled = false
    let everConnected = socket.connected

    const syncMode = (): void => {
      if (!cancelled) setMode(modeFor(socket.connected, everConnected, !fleet.isError))
    }

    const joinAll = (): void => {
      everConnected = true
      for (const r of fleet.data ?? []) {
        for (const d of r.deliveries) void joinParcelRoom(d.parcelId)
      }
      syncMode()
    }

    const onLocation = (raw: LocationBroadcast): void => {
      if (cancelled) return
      const agentId = agentByDelivery.get(raw.deliveryId)
      if (!agentId) return
      setLivePoints((prev) => ({ ...prev, [agentId]: raw.point }))
    }

    const onStatus = (_raw: StatusChanged): void => {
      if (cancelled) return
      /**
       * status:changed updates the board without a manual refresh.
       * Invalidating rather than patching keeps the table and the map reading
       * from the same server truth.
       */
      void qc.invalidateQueries({ queryKey: ['deliveries'] })
      void qc.invalidateQueries({ queryKey: fleetKey })
    }

    socket.on('connect', joinAll)
    socket.on('disconnect', syncMode)
    socket.on(SOCKET_EVENTS.locationBroadcast, onLocation)
    socket.on(SOCKET_EVENTS.statusChanged, onStatus)

    if (socket.connected) joinAll()
    else {
      socket.connect()
      syncMode()
    }

    return () => {
      cancelled = true
      socket.off('connect', joinAll)
      socket.off('disconnect', syncMode)
      socket.off(SOCKET_EVENTS.locationBroadcast, onLocation)
      socket.off(SOCKET_EVENTS.statusChanged, onStatus)
    }
  }, [fleet.data, fleet.isError, qc, agentByDelivery])

  const busyCount = (fleet.data ?? []).filter((r) => r.status === 'on_delivery').length
  const availableCount = (fleet.data ?? []).length - busyCount
  const activeDeliveries = (fleet.data ?? []).reduce((n, r) => n + r.deliveries.length, 0)

  /**
   * One marker per agent — the server already returns one row per rider, so
   * there is no dedup left to do here, only the busy/idle split (a solid
   * filled disc vs. a hollow accent ring — see TrackingMap's own note) and
   * preferring a live socket point over the persisted one it can supersede.
   */
  const riders: MapRider[] = (fleet.data ?? []).map((r) => {
    const busy = r.status === 'on_delivery'
    const first = r.deliveries[0]
    return {
      id: r.agentId,
      point: livePoints[r.agentId] ?? r.point,
      label: r.agentName,
      sublabel: busy
        ? r.deliveries.length > 1
          ? `${r.deliveries.length} parcels`
          : (first?.trackingId ?? 'On delivery')
        : 'Available',
      busy,
    }
  })

  return (
    <Card
      title={`Fleet · ${riders.length} rider${riders.length === 1 ? '' : 's'} (${busyCount} busy, ${availableCount} available) · ${activeDeliveries} active deliver${activeDeliveries === 1 ? 'y' : 'ies'}`}
      action={<ConnectionPill mode={mode} />}
      className="mb-5"
    >
      {fleet.isError ? (
        <p role="alert" className="text-sm text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2">
          {fleet.error instanceof ApiError
            ? fleet.error.message
            : 'Rider positions could not be loaded.'}
        </p>
      ) : (
        <div className="relative h-[380px] rounded-md overflow-hidden border border-border bg-map-ground">
          <LazyTrackingMap className="absolute inset-0" riders={riders} animate />
          {/*
            Three states over one map, not two: an empty fleet and a fleet that
            has not loaded yet look identical on the canvas, and telling an admin
            "nobody is out there" while the request is still in flight is a lie
            that resolves itself — but only after they have believed it.
          */}
          {fleet.isPending ? (
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <p className="text-sm text-muted bg-page/[0.92] border border-border rounded-sm px-3 py-2">
                Locating riders…
              </p>
            </div>
          ) : riders.length === 0 ? (
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <p className="text-sm text-muted bg-page/[0.92] border border-border rounded-sm px-3 py-2">
                No rider is on shift with a known position. Run the simulator,
                or set a rider's location from Shift.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  )
}
