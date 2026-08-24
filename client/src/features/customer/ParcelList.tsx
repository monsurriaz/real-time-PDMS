import { useState } from 'react'
import { Link } from 'react-router-dom'
import { deliveryStatusSchema, type DeliveryStatus } from '@pdms/shared'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { Panel } from '@/components/Panel'
import { ApiError } from '@/lib/api'
import { formatDateTime, formatKg, formatTaka } from '@/lib/format'
import { useParcels } from '../booking/useBooking'
import { useAdvanceStatus } from '../deliveries/useDeliveries'

/**
 * Cancelling before pickup, per section 5. Two taps: the second confirms,
 * because a cancellation is not reversible and the button sits in a dense row
 * where a mis-tap is easy.
 */
const CancelButton = ({
  deliveryId,
  trackingId,
}: {
  deliveryId: string
  trackingId: string
}) => {
  const advance = useAdvanceStatus()
  const [armed, setArmed] = useState(false)

  if (advance.isError) {
    return (
      <span role="alert" className="text-[11.5px] text-failed-ink">
        {advance.error instanceof ApiError ? advance.error.message : 'Could not cancel'}
      </span>
    )
  }

  return armed ? (
    <span className="flex items-center gap-2">
      <Button
        disabled={advance.isPending}
        onClick={() =>
          advance.mutate({ deliveryId, to: 'Cancelled', note: 'Cancelled by customer' })
        }
      >
        {advance.isPending ? 'Cancelling…' : 'Confirm'}
      </Button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="text-[12px] text-muted hover:text-ink"
      >
        Keep
      </button>
    </span>
  ) : (
    <Button onClick={() => setArmed(true)} aria-label={`Cancel ${trackingId}`}>
      Cancel
    </Button>
  )
}

/**
 * The customer's parcels. Status comes from the Delivery record and is shown
 * with the design system's Badge — no new status component.
 *
 * Every number here is in the mono face with tabular figures (section 4), so
 * the price and weight columns line up down the list.
 */

/** The list endpoint types status as a string; narrow it before rendering. */
const asStatus = (raw: string): DeliveryStatus => {
  const parsed = deliveryStatusSchema.safeParse(raw)
  // An unrecognised status means the server knows a state this build does not.
  // Showing it as Booked would be a lie, so fall back to the neutral pill and
  // let the text carry the truth.
  return parsed.success ? parsed.data : 'Booked'
}

export const ParcelList = () => {
  const parcels = useParcels()

  if (parcels.isPending) {
    return (
      <Panel>
        <p className="text-[13.5px] text-muted">Loading your parcels…</p>
      </Panel>
    )
  }

  if (parcels.isError) {
    return (
      <Panel>
        <p role="alert" className="text-[13px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2">
          {parcels.error instanceof ApiError
            ? parcels.error.message
            : 'Your parcels could not be loaded.'}
        </p>
      </Panel>
    )
  }

  if (parcels.data.length === 0) {
    return (
      <Panel>
        <p className="text-[13.5px] text-muted mb-4">
          You have not booked anything yet.
        </p>
        <Link to="/book">
          <Button variant="primary">Book a parcel</Button>
        </Link>
      </Panel>
    )
  }

  return (
    <Panel
      title={`${parcels.data.length} parcel${parcels.data.length === 1 ? '' : 's'}`}
      action={
        <Link to="/book">
          <Button variant="primary">Book a parcel</Button>
        </Link>
      }
    >
      {/* Wide content scrolls inside its own container, never the page. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[620px]">
          <thead>
            <tr>
              {['Tracking', 'Route', 'Weight', 'Status', 'Price', 'Booked', ''].map((h) => (
                <th
                  key={h}
                  className="text-left text-[11px] font-semibold uppercase tracking-[0.13em] text-faint pb-3 border-b border-hairline"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parcels.data.map((p) => (
              <tr key={p._id} className="border-b border-hairline last:border-b-0">
                <td className="py-3 pr-4">
                  <span className="mono text-[12.5px] font-medium">{p.trackingId}</span>
                </td>
                <td className="py-3 pr-4 text-[13px] text-ink-2">
                  {p.pickupArea} → {p.dropArea}
                </td>
                <td className="py-3 pr-4">
                  <span className="mono text-[13px]">{formatKg(p.weightKg)}</span>
                </td>
                <td className="py-3 pr-4">
                  <Badge status={asStatus(p.status)} />
                </td>
                <td className="py-3 pr-4">
                  <span className="mono text-[13.5px]">{formatTaka(p.total)}</span>
                  {p.isCod ? (
                    <span className="block text-[11px] text-faint mono">
                      COD {formatTaka(p.codAmount)}
                    </span>
                  ) : null}
                </td>
                <td className="py-3 pr-4">
                  <span className="mono text-[12px] text-muted">
                    {formatDateTime(p.createdAt)}
                  </span>
                </td>
                <td className="py-3">
                  {/*
                    Offered only where the server says cancelling is legal —
                    before pickup. It re-checks when clicked (rule 3).
                  */}
                  {p.deliveryId && p.allowedTransitions.includes('Cancelled') ? (
                    <CancelButton deliveryId={p.deliveryId} trackingId={p.trackingId} />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
