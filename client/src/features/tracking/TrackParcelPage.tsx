import { Link, useParams } from 'react-router-dom'
import type { GeoPoint, ProofOfDelivery } from '@pdms/shared'
import { Badge } from '@/components/Badge'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { LifecycleRail } from '@/components/LifecycleRail'
import { LazyTrackingMap } from '@/components/LazyTrackingMap'
import type { MapRider } from '@/components/TrackingMap'
import { ApiError } from '@/lib/api'
import { formatDateTime, formatKg, formatTaka } from '@/lib/format'
import { AppShell } from '@/components/AppShell'
import { ConnectionPill } from './ConnectionPill'
import { EventTimeline } from './EventTimeline'
import { useLiveTracking } from './useLiveTracking'

/**
 * Customer live tracking, matching the customer mockup in
 * docs/design-system.html: map-forward, with the detail panel beside it —
 * lifecycle rail, rider card, key-value block, event timeline.
 *
 * The map is the largest object on the page and the only place saturated
 * colour appears; everything else is page, ink and borders.
 */

const KeyRow = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex justify-between items-baseline py-10px border-b border-border last:border-b-0">
    <span className="text-small text-muted">{k}</span>
    <span className="text-sm">{children}</span>
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


/**
 * The outstanding delivery code.
 *
 * Deliberately the loudest thing in the detail column while it is live: the
 * rider is standing at the door waiting for it, and a code the sender has to
 * hunt for is a code that gets read out wrong. It disappears on its own — the
 * server stops returning it once the code is used or expires.
 */
const DeliveryCode = ({ code, expiresAt }: { code: string; expiresAt: string }) => (
  <div className="mt-4 p-4 border-l-2 border-accent bg-accent-tint rounded-r-sm">
    <p className="text-eyebrow font-semibold uppercase tracking-[0.13em] text-accent-hover">
      Delivery code
    </p>
    <p className="mono text-figure-xl font-medium tracking-[0.22em] mt-1">{code}</p>
    <p className="text-meta text-ink-2 mt-1.5">
      Read this to the rider. Expires{' '}
      <span className="mono">
        {new Date(expiresAt).toLocaleTimeString('en-BD', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
      .
    </p>
  </div>
)

/** What was recorded at the door, once a delivery is proven. */
const PROOF_LABEL: Record<string, string> = {
  photo: 'Photo taken at the door',
  otp: 'Code confirmed by the recipient',
  signature: 'Signed for',
}

const ProofPanel = ({ proof }: { proof: ProofOfDelivery }) => (
  <div className="mt-4 p-13px bg-delivered-bg rounded-md">
    <p className="text-eyebrow font-semibold uppercase tracking-[0.13em] text-delivered-ink">
      Proof of delivery
    </p>
    <p className="text-sm text-delivered-ink mt-1">
      {PROOF_LABEL[proof.method] ?? proof.method}
      {proof.receivedBy ? ` · ${proof.receivedBy}` : ''}
    </p>
    {proof.photoUrl ? (
      // The record holds a URL, so this is a link to Cloudinary rather than an
      // image stored anywhere near our database.
      <a
        href={proof.photoUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-block mt-2 text-small font-medium text-delivered-ink underline decoration-current/40 hover:decoration-current"
      >
        View the photo
      </a>
    ) : null}
    <p className="mono text-tiny text-delivered-ink/80 mt-1.5">
      {formatDateTime(proof.capturedAt)}
    </p>
  </div>
)

export const TrackParcelPage = () => {
  const { parcelId } = useParams<{ parcelId: string }>()
  const { snapshot, mode, point, lastTickAt } = useLiveTracking(parcelId)

  if (snapshot.isPending) {
    return (
      <AppShell title="Tracking">
        <Card>
          <p className="text-body text-muted">Loading the parcel…</p>
        </Card>
      </AppShell>
    )
  }

  if (snapshot.isError || !snapshot.data) {
    return (
      <AppShell title="Tracking">
        <Card>
          <p
            role="alert"
            className="text-sm text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 max-w-[520px]"
          >
            {snapshot.error instanceof ApiError
              ? snapshot.error.message
              : 'This parcel could not be loaded.'}
          </p>
          <Link to="/customer/parcels" className="inline-block mt-4">
            <Button>Back to my parcels</Button>
          </Link>
        </Card>
      </AppShell>
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
    <AppShell
      title={parcel.trackingId}
      titleAside={
        <span className="flex items-center gap-2">
          <Badge status={delivery.status} />
          <ConnectionPill mode={mode} compact />
        </span>
      }
    >
      {/*
        v3 puts the map FIRST and the detail column at 310px on the right —
        the reverse of the old build. The map is the largest object on the page
        and the only place saturated colour appears, so it leads.
      */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="grid lg:grid-cols-[1fr_310px]">
          {/* The map: largest object on the page. */}
          <div className="relative min-h-[340px] lg:min-h-[560px] bg-map-ground">
            <LazyTrackingMap
              className="absolute inset-0"
              riders={riders}
              route={route}
              pickup={parcel.pickup.point}
              drop={parcel.drop.point}
              follow={moving}
              animate
            />
            {riders.length === 0 ? (
              // Floated clear of the bottom edge: the tile attribution lives
              // there, and a full-width bar sat on top of the credit the
              // licence requires us to show.
              <div className="absolute inset-x-3 bottom-8 flex justify-center pointer-events-none">
                <p className="text-small text-muted bg-surface/[0.94] border border-border rounded-pill px-3 py-1.5">
                  {moving
                    ? 'Waiting for the first position from the rider.'
                    : 'Not moving — no live position to show.'}
                </p>
              </div>
            ) : null}
          </div>

          <div className="lg:border-l border-border p-18px overflow-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-figure font-semibold tracking-[-0.02em]">
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
                <div className="text-sm text-muted mt-0.5">
                  {parcel.pickup.area} → {parcel.drop.area}
                </div>
              </div>
              {/*
                No badge here: the shell header carries the status now, and two
                copies of the same pill on one screen makes neither the
                authority.
              */}
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
                <div className="w-9 h-9 rounded-full bg-border-strong flex-none" />
                <div className="flex-1 min-w-0">
                  <div className="text-body font-semibold truncate">
                    {rider.name}
                  </div>
                  <div className="text-meta text-muted">
                    {distanceKm !== null
                      ? `${distanceKm.toFixed(1)} km away · ${rider.vehicle}`
                      : rider.vehicle}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-[13px] bg-surface-sunk rounded-md my-4">
                <p className="text-small text-muted">
                  No rider assigned yet.
                </p>
              </div>
            )}

            {snapshot.data.otp ? (
              <DeliveryCode
                code={snapshot.data.otp.code}
                expiresAt={snapshot.data.otp.expiresAt}
              />
            ) : null}

            {delivery.proofOfDelivery ? (
              <ProofPanel proof={delivery.proofOfDelivery} />
            ) : null}

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
                  <span className="mono text-meta">
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

        </div>
      </div>
    </AppShell>
  )
}
