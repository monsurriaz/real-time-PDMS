import { Link, useParams } from 'react-router-dom'
import type { GeoPoint } from '@pdms/shared'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { LifecycleRail } from '@/components/LifecycleRail'
import { TrackingMap, type MapRider } from '@/components/TrackingMap'
import { ApiError } from '@/lib/api'
import { formatKg, formatTaka } from '@/lib/format'
import { RoleShell } from '@/components/RoleShell'
import { ConnectionPill } from './ConnectionPill'
import { EventTimeline } from './EventTimeline'
import { useLiveTracking } from './useLiveTracking'

/**
 * Customer live tracking, matching the customer mockup in
 * docs/design-system.html: map-forward, with the detail panel beside it —
 * lifecycle rail, rider card, key-value block, event timeline.
 *
 * The map is the largest object on the page and the only place saturated
 * colour appears; everything else is paper, ink and hairlines.
 */

const NAV = [
  { to: '/', label: 'My parcels' },
  { to: '/book', label: 'Book' },
] as const

const KeyRow = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex justify-between items-baseline py-10px border-b border-hairline last:border-b-0">
    <span className="text-[12.5px] text-muted">{k}</span>
    <span className="text-[13px]">{children}</span>
  </div>
)

/** Straight-line distance, for the "x km away" line on the rider card. */
const kmBetween = (a: GeoPoint, b: GeoPoint): number => {
  const toRad = (d: number): number => (d * Math.PI) / 180
  const [lng1, lat1] = a.coordinates
  const [lng2, lat2] = b.coordinates
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

export const TrackParcelPage = () => {
  const { parcelId } = useParams<{ parcelId: string }>()
  const { snapshot, mode, point, history, lastTickAt } = useLiveTracking(parcelId)

  if (snapshot.isPending) {
    return (
      <RoleShell title="Tracking" nav={NAV}>
        <p className="text-[13.5px] text-muted">Loading…</p>
      </RoleShell>
    )
  }

  if (snapshot.isError || !snapshot.data) {
    return (
      <RoleShell title="Tracking" nav={NAV}>
        <p role="alert" className="text-[13px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 max-w-[520px]">
          {snapshot.error instanceof ApiError
            ? snapshot.error.message
            : 'This parcel could not be loaded.'}
        </p>
        <Link to="/" className="inline-block mt-4">
          <Button>Back to my parcels</Button>
        </Link>
      </RoleShell>
    )
  }

  const { parcel, delivery, rider, route } = snapshot.data
  const moving = ['Assigned', 'PickedUp', 'InTransit'].includes(delivery.status)

  const riders: MapRider[] =
    point && moving
      ? [
          {
            id: delivery._id,
            point,
            label: rider?.name ?? 'Rider',
            ...(lastTickAt ? { sublabel: 'live' } : {}),
          },
        ]
      : []

  const distanceKm =
    point && parcel.drop.point ? kmBetween(point, parcel.drop.point) : null

  return (
    <RoleShell title="Tracking" nav={NAV}>
      {/* The `.screen` frame from the reference: one surface, hairline, radius-lg. */}
      <div className="bg-surface border border-hairline rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-[14px] border-b border-hairline">
          <Link to="/" className="text-[12.5px] text-muted hover:text-ink">
            My parcels
          </Link>
          <span className="text-faint">/</span>
          <span className="mono text-[12.5px] font-medium">{parcel.trackingId}</span>
          <div className="ml-auto">
            <ConnectionPill mode={mode} />
          </div>
        </div>

        {/* 340px detail column beside the map, per the reference. */}
        <div className="grid lg:grid-cols-[340px_1fr]">
          <div className="lg:border-r border-hairline p-22px">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[19px] font-semibold tracking-[-0.02em]">
                  {delivery.status === 'InTransit'
                    ? 'On the way'
                    : delivery.status === 'Delivered'
                      ? 'Delivered'
                      : delivery.status === 'Failed'
                        ? 'Could not deliver'
                        : delivery.status === 'Cancelled'
                          ? 'Cancelled'
                          : 'Preparing'}
                </div>
                <div className="text-[13px] text-muted mt-0.5">
                  {parcel.pickup.area} → {parcel.drop.area}
                </div>
              </div>
              <Badge status={delivery.status} />
            </div>

            <div className="my-5">
              {/*
                `live` is the real connection state, so the travelling
                highlight means updates are arriving — frozen means the socket
                dropped and we are polling.
              */}
              <LifecycleRail
                status={delivery.status}
                live={mode === 'live' && moving}
                labels
              />
            </div>

            {rider ? (
              <div className="flex items-center gap-11px p-[13px] bg-surface-sunk rounded-md my-4">
                <div className="w-9 h-9 rounded-full bg-hairline-strong flex-none" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold truncate">
                    {rider.name}
                  </div>
                  <div className="text-[12px] text-muted">
                    {distanceKm !== null
                      ? `${distanceKm.toFixed(1)} km away · ${rider.vehicle}`
                      : rider.vehicle}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-[13px] bg-surface-sunk rounded-md my-4">
                <p className="text-[12.5px] text-muted">
                  No rider assigned yet.
                </p>
              </div>
            )}

            <div>
              <KeyRow k="Tracking ID">
                <span className="mono">{parcel.trackingId}</span>
              </KeyRow>
              <KeyRow k="Weight">
                <span className="mono">{formatKg(parcel.weightKg)}</span>
              </KeyRow>
              <KeyRow k="Payment">{parcel.isCod ? 'COD' : 'Prepaid'}</KeyRow>
              <KeyRow k={parcel.isCod ? 'Amount due' : 'Paid'}>
                <span className="mono font-medium">
                  {formatTaka(parcel.isCod ? parcel.codAmount : parcel.total)}
                </span>
              </KeyRow>
              {delivery.lastLocationAt && mode !== 'live' ? (
                <KeyRow k="Position from">
                  <span className="mono text-[12px]">
                    {new Date(delivery.lastLocationAt).toLocaleTimeString('en-BD', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </KeyRow>
              ) : null}
            </div>

            <EventTimeline
              events={delivery.events}
              status={delivery.status}
              expectedBy={delivery.expectedBy}
              dropArea={parcel.drop.area}
            />
          </div>

          {/* The map: largest object on the page. */}
          <div className="relative min-h-[430px] lg:min-h-[560px] bg-surface-sunk">
            <TrackingMap
              className="absolute inset-0"
              riders={riders}
              route={route}
              pickup={parcel.pickup.point}
              drop={parcel.drop.point}
              trail={history}
              follow={moving}
              animate
            />
            {riders.length === 0 ? (
              <div className="absolute inset-x-0 bottom-0 p-3 bg-paper/[0.92] border-t border-hairline">
                <p className="text-[12.5px] text-muted text-center">
                  {moving
                    ? 'Waiting for the first position from the rider.'
                    : 'This parcel is not moving — no live position to show.'}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </RoleShell>
  )
}
