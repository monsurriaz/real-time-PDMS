import type { DeliveryEvent, DeliveryStatus } from '@pdms/shared'

/**
 * The `.timeline` from docs/design-system.html: a node per event, teal for
 * done, orange with a ring for the current one, hollow for what has not
 * happened yet.
 */

const LABEL: Record<DeliveryStatus, string> = {
  Booked: 'Booked',
  Assigned: 'Rider assigned',
  PickedUp: 'Picked up',
  InTransit: 'In transit',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
  Failed: 'Delivery failed',
}

const time = (d: Date | string): string =>
  new Date(d).toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' })

interface Props {
  events: DeliveryEvent[]
  status: DeliveryStatus
  /** Shown as the un-reached final row when the parcel is still moving. */
  expectedBy?: string | null
  dropArea: string
}

export const EventTimeline = ({ events, status, expectedBy, dropArea }: Props) => {
  const finished =
    status === 'Delivered' || status === 'Cancelled' || status === 'Failed'

  return (
    <div className="mt-5">
      {events.map((e, i) => {
        const isLast = i === events.length - 1
        const now = isLast && !finished
        return (
          <div key={`${e.status}-${i}`} className="flex gap-3 pb-4 relative">
            {/* Connector, drawn behind the nodes. */}
            {i < events.length - 1 || !finished ? (
              <span className="absolute left-[6px] top-[16px] bottom-0 w-px bg-hairline" />
            ) : null}
            <span
              className={[
                'w-[13px] h-[13px] rounded-full flex-none mt-[3px] z-1 border-[2.5px]',
                now
                  ? 'bg-transit border-transit ring-4 ring-transit-bg'
                  : 'bg-picked border-picked',
              ].join(' ')}
            />
            <div className="flex-1">
              <div
                className={`text-[13.5px] font-semibold ${now ? 'text-transit' : ''}`}
              >
                {LABEL[e.status]}
              </div>
              {e.note ? (
                <div className="text-[12px] text-muted">{e.note}</div>
              ) : e.actorRole ? (
                <div className="text-[12px] text-muted">by the {e.actorRole}</div>
              ) : (
                <div className="text-[12px] text-muted">automatic</div>
              )}
            </div>
            <span className="mono text-[11.5px] text-faint whitespace-nowrap">
              {time(e.at)}
            </span>
          </div>
        )
      })}

      {/* The step still to come, so the journey has a visible end. */}
      {!finished ? (
        <div className="flex gap-3 relative">
          <span className="w-[13px] h-[13px] rounded-full flex-none mt-[3px] border-[2.5px] border-hairline-strong bg-surface" />
          <div className="flex-1">
            <div className="text-[13.5px] font-semibold text-faint">Delivered</div>
            <div className="text-[12px] text-muted">{dropArea}</div>
          </div>
          <span className="mono text-[11.5px] text-faint whitespace-nowrap">
            {expectedBy ? `~${time(expectedBy)}` : '—'}
          </span>
        </div>
      ) : null}
    </div>
  )
}
