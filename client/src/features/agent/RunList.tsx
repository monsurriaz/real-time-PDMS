import type { DeliveryStatus } from '@pdms/shared'
import { Badge } from '@/components/Badge'
import { Card, Eyebrow } from '@/components/Card'
import { ApiError } from '@/lib/api'
import { useDeliveries } from '../deliveries/useDeliveries'
import { ActiveDelivery } from './ActiveDelivery'
import { ShiftControls } from './ShiftControls'

/**
 * The rider's screen: shift controls, then whatever they are carrying, each as
 * the phone-mockup card from docs/design-system.html.
 *
 * Light, not dark — riders work in Dhaka daylight (CLAUDE.md section 4).
 */

/** Still in play. Terminal states drop to the finished list. */
const ACTIVE: readonly DeliveryStatus[] = ['Assigned', 'PickedUp', 'InTransit']

export const RunList = () => {
  const deliveries = useDeliveries()

  return (
    <div className="max-w-[420px]">
      <ShiftControls />

      {deliveries.isPending ? (
        <Card>
          <p className="text-body text-muted">Loading your runs…</p>
        </Card>
      ) : deliveries.isError ? (
        <Card>
          <p role="alert" className="text-sm text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2">
            {deliveries.error instanceof ApiError
              ? deliveries.error.message
              : 'Your runs could not be loaded.'}
          </p>
        </Card>
      ) : (
        <>
          {(() => {
            const active = deliveries.data.filter((d) => ACTIVE.includes(d.status))
            const done = deliveries.data.filter((d) => !ACTIVE.includes(d.status))

            return (
              <>
                {active.length > 0 ? (
                  <>
                    <Eyebrow tone="strong">
                      {active.length === 1
                        ? 'Active delivery'
                        : `${active.length} active`}
                    </Eyebrow>
                    {active.map((d) => (
                      <ActiveDelivery key={d._id} d={d} />
                    ))}
                  </>
                ) : (
                  <Card className="mb-5">
                    <p className="text-body text-muted">
                      Nothing to carry right now. Go available and set your
                      location — new bookings are assigned by proximity.
                    </p>
                  </Card>
                )}

                {done.length > 0 ? (
                  <>
                    <Eyebrow tone="strong">Finished · {done.length}</Eyebrow>
                    <Card>
                      {done.map((d) => (
                        <div
                          key={d._id}
                          className="flex items-center justify-between gap-3 py-3 border-b border-border last:border-b-0"
                        >
                          <div>
                            <span className="mono text-small font-medium block">
                              {d.trackingId}
                            </span>
                            <span className="text-meta text-muted">
                              {d.pickupArea} → {d.dropArea}
                            </span>
                          </div>
                          <Badge status={d.status} />
                        </div>
                      ))}
                    </Card>
                  </>
                ) : null}
              </>
            )
          })()}
        </>
      )}
    </div>
  )
}
