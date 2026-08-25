import { Link } from 'react-router-dom'
import { Badge } from '@/components/Badge'
import { LazyTrackingMap } from '@/components/LazyTrackingMap'
import type { MapRider } from '@/components/TrackingMap'
import { LifecycleRail } from '@/components/LifecycleRail'
import { PublicFooter } from '@/components/PublicFooter'
import { ApiError } from '@/lib/api'
import { usePublicTracking } from './usePublicTracking'

/**
 * /track/:trackingId — v3's public route table entry: track by ID, no
 * login. Deliberately smaller than the authenticated customer screen — see
 * publicTrackingSnapshotSchema's own note on what this withholds and why —
 * so this page has no key-value block of price/weight, no event timeline,
 * no delivery code. Badge, rail, route, done.
 */

const STATUS_HEADLINE: Record<string, string> = {
  Booked: 'Booked',
  Assigned: 'Rider assigned',
  PickedUp: 'Picked up',
  InTransit: 'On the way',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
  Failed: 'Could not be delivered',
}

const PublicNav = () => (
  <nav className="flex items-center gap-9px px-22px py-4 max-w-[720px] mx-auto">
    <Link to="/" className="flex items-center gap-9px font-bold text-md tracking-[-0.03em]">
      <span className="w-3.5 h-3.5 bg-accent rounded-mark rotate-45 flex-none" />
      ParcelDelivery
    </Link>
    <Link to="/login" className="ml-auto text-body text-muted hover:text-ink">
      Sign in
    </Link>
  </nav>
)

export const PublicTrackPage = ({ trackingId }: { trackingId: string }) => {
  const tracking = usePublicTracking(trackingId)

  return (
    <div className="min-h-dvh bg-page flex flex-col">
      <PublicNav />

      <div className="max-w-[720px] mx-auto px-22px pb-16 flex-1 w-full">
        {tracking.isPending ? (
          <p className="text-body text-muted text-center py-16">Looking it up…</p>
        ) : tracking.isError || !tracking.data ? (
          <div className="bg-surface border border-border rounded-lg p-6 text-center">
            <p className="text-lg font-semibold tracking-[-0.02em]">Nothing found</p>
            <p className="text-body text-muted mt-2">
              {tracking.error instanceof ApiError && tracking.error.status === 404
                ? `No parcel matches "${trackingId}". Check the tracking ID and try again.`
                : 'This tracking ID could not be looked up right now.'}
            </p>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <div className="grid lg:grid-cols-[1fr_290px]">
              <div className="relative min-h-[280px] lg:min-h-[420px] bg-map-ground">
                <LazyTrackingMap
                  className="absolute inset-0"
                  riders={
                    tracking.data.point
                      ? ([
                          {
                            id: tracking.data.trackingId,
                            point: tracking.data.point,
                            label: tracking.data.rider?.name ?? 'Rider',
                          },
                        ] satisfies MapRider[])
                      : []
                  }
                  route={tracking.data.route}
                  follow={false}
                  animate
                />
              </div>

              <div className="lg:border-l border-border p-18px">
                <div className="flex items-center justify-between gap-3">
                  <span className="mono text-small font-medium">{tracking.data.trackingId}</span>
                  <Badge status={tracking.data.status} />
                </div>

                <div className="text-figure font-semibold tracking-[-0.02em] mt-3">
                  {STATUS_HEADLINE[tracking.data.status] ?? tracking.data.status}
                </div>
                <div className="text-sm text-muted mt-0.5">
                  {tracking.data.pickup.area} → {tracking.data.drop.area}
                </div>

                <div className="my-4">
                  <LifecycleRail status={tracking.data.status} labels />
                </div>

                {tracking.data.rider ? (
                  <div className="flex items-center gap-11px p-[13px] bg-surface-sunk rounded-md">
                    <div className="w-9 h-9 rounded-full bg-border-strong flex-none" />
                    <div className="flex-1 min-w-0">
                      <div className="text-body font-semibold truncate">{tracking.data.rider.name}</div>
                      <div className="text-meta text-muted capitalize">
                        {tracking.data.rider.vehicle}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-[13px] bg-surface-sunk rounded-md">
                    <p className="text-small text-muted">No rider assigned yet.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <PublicFooter />
    </div>
  )
}
