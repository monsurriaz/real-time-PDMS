import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  REST_POLL_INTERVAL_MS,
  SOCKET_EVENTS,
  type ConnectionMode,
  type DeliveryStatus,
  type GeoPoint,
  type LocationBroadcast,
  type StatusChanged,
} from '@pdms/shared'
import { Panel } from '@/components/Panel'
import { LazyTrackingMap } from '@/components/LazyTrackingMap'
import type { MapRider } from '@/components/TrackingMap'
import { ApiError, api } from '@/lib/api'
import { getSocket, joinParcelRoom, modeFor } from '@/lib/socket'
import { ConnectionPill } from '../tracking/ConnectionPill'

/**
 * Every active rider on one map (M4, step 4).
 *
 * The admin joins each active parcel's room, so positions arrive over the same
 * socket the customer screen uses — there is no second broadcast path. When
 * the socket is down the same REST endpoint polls every 10s, which is section
 * 6's fallback applied to the fleet rather than to one parcel.
 */

interface FleetRider {
  deliveryId: string
  parcelId: string
  trackingId: string
  dropArea: string
  status: DeliveryStatus
  agentId: string | null
  agentName: string | null
  point: GeoPoint
  at: string | null
}

const fleetKey = ['tracking', 'fleet'] as const

export const FleetMap = () => {
  const qc = useQueryClient()
  const [mode, setMode] = useState<ConnectionMode>('connecting')
  const [livePoints, setLivePoints] = useState<Record<string, GeoPoint>>({})

  const fleet = useQuery({
    queryKey: fleetKey,
    queryFn: () => api.get<{ riders: FleetRider[] }>('/tracking/active/positions'),
    select: (d) => d.riders,
    refetchInterval:
      mode === 'polling' || mode === 'offline' ? REST_POLL_INTERVAL_MS : false,
  })

  // ---- join every active parcel's room ----
  useEffect(() => {
    const socket = getSocket()
    let cancelled = false
    let everConnected = socket.connected

    const syncMode = (): void => {
      if (!cancelled) setMode(modeFor(socket.connected, everConnected, !fleet.isError))
    }

    const joinAll = (): void => {
      everConnected = true
      for (const r of fleet.data ?? []) void joinParcelRoom(r.parcelId)
      syncMode()
    }

    const onLocation = (raw: LocationBroadcast): void => {
      if (cancelled) return
      setLivePoints((prev) => ({ ...prev, [raw.deliveryId]: raw.point }))
    }

    const onStatus = (_raw: StatusChanged): void => {
      if (cancelled) return
      /**
       * Step 4: status:changed updates the board without a manual refresh.
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
  }, [fleet.data, fleet.isError, qc])

  /**
   * One marker per RIDER, not per delivery.
   *
   * A rider holding three parcels appeared three times, stacked at the same
   * coordinates, and the panel counted deliveries while calling them riders.
   * A person has one position, so the rows are collapsed by agent and the
   * freshest position wins — a socket tick beating a persisted one that can be
   * 30 seconds old.
   */
  const byRider = new Map<string, { r: FleetRider; point: GeoPoint; count: number }>()
  for (const r of fleet.data ?? []) {
    const key = r.agentId ?? `delivery:${r.deliveryId}`
    const point = livePoints[r.deliveryId] ?? r.point
    const existing = byRider.get(key)
    if (!existing) {
      byRider.set(key, { r, point, count: 1 })
      continue
    }
    existing.count += 1
    // Prefer a live socket point, then the more recent persisted one.
    const isLive = Boolean(livePoints[r.deliveryId])
    const newer = (r.at ?? '') > (existing.r.at ?? '')
    if (isLive || newer) {
      existing.r = r
      existing.point = point
    }
  }

  const riders: MapRider[] = [...byRider.entries()].map(([key, v]) => ({
    id: key,
    point: v.point,
    label: v.r.agentName ?? v.r.trackingId,
    sublabel: v.count > 1 ? `${v.count} parcels` : v.r.trackingId,
  }))

  return (
    <Panel
      title={`Fleet · ${riders.length} rider${riders.length === 1 ? '' : 's'} · ${(fleet.data ?? []).length} active deliver${(fleet.data ?? []).length === 1 ? 'y' : 'ies'}`}
      action={<ConnectionPill mode={mode} />}
      className="mb-5"
    >
      {fleet.isError ? (
        <p role="alert" className="text-[13px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2">
          {fleet.error instanceof ApiError
            ? fleet.error.message
            : 'Rider positions could not be loaded.'}
        </p>
      ) : (
        <div className="relative h-[380px] rounded-md overflow-hidden border border-hairline bg-surface-sunk">
          <LazyTrackingMap className="absolute inset-0" riders={riders} animate />
          {/*
            Three states over one map, not two: an empty fleet and a fleet that
            has not loaded yet look identical on the canvas, and telling an admin
            "nobody is out there" while the request is still in flight is a lie
            that resolves itself — but only after they have believed it.
          */}
          {fleet.isPending ? (
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <p className="text-[13px] text-muted bg-paper/[0.92] border border-hairline rounded-sm px-3 py-2">
                Locating riders…
              </p>
            </div>
          ) : riders.length === 0 ? (
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <p className="text-[13px] text-muted bg-paper/[0.92] border border-hairline rounded-sm px-3 py-2">
                No active rider has reported a position yet. Run the simulator to
                see movement.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  )
}
