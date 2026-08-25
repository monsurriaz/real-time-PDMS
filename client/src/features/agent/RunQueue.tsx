import { Link } from 'react-router-dom'
import type { DeliveryListItem } from '@pdms/shared'
import { Badge } from '@/components/Badge'
import { Eyebrow } from '@/components/Card'

/**
 * The compact run list beside the active delivery — v3's "Up next", but
 * carrying every active run rather than only the ones behind the current
 * one. That's deliberate: when a rider is holding more than one parcel, this
 * list IS how they switch which one is on the left, so the current row has
 * to be in it too, highlighted rather than omitted.
 *
 * Each row routes to /agent/runs/:id — a real URL per selection, so a rider
 * can hand a link to a specific run rather than always landing on whichever
 * one the workspace happened to default to.
 */
export const RunQueue = ({
  deliveries,
  currentId,
}: {
  deliveries: readonly DeliveryListItem[]
  currentId: string
}) => (
  <div className="mt-22px">
    <Eyebrow>{deliveries.length === 1 ? 'Your run' : `Your runs · ${deliveries.length}`}</Eyebrow>
    <div className="mt-9px flex flex-col gap-px">
      {deliveries.map((d) => {
        const current = d._id === currentId
        return (
          <Link
            key={d._id}
            to={`/agent/runs/${d._id}`}
            aria-current={current ? 'true' : undefined}
            className={[
              'flex items-center gap-3 py-11px px-9px -mx-9px rounded-sm min-h-12',
              current ? 'bg-accent-tint' : 'hover:bg-surface-sunk',
            ].join(' ')}
          >
            <div className="flex-1 min-w-0">
              <div className="mono text-small font-medium truncate">{d.trackingId}</div>
              <div className="text-tiny text-muted truncate">{d.recipientName}</div>
            </div>
            <Badge status={d.status} />
          </Link>
        )
      })}
    </div>
  </div>
)
