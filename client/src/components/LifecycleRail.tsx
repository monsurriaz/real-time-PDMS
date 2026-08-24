import type { DeliveryStatus } from '@pdms/shared'

/**
 * The `.rail` from docs/design-system.html — five 5px pill segments with a 4px
 * gap, one per step of the happy path, optionally with labels underneath.
 *
 * The travelling highlight on the live segment is a LIVENESS INDICATOR, not
 * decoration. It runs only while `live` is true, which the tracking screen
 * wires to whether socket updates are actually arriving. Moving means live;
 * frozen means the socket dropped and the screen is on the REST fallback. That
 * is why passing `live` is required rather than defaulted — a rail that
 * shimmered unconditionally would be lying.
 */

/** The happy path, in order. Terminal side-exits are not rail positions. */
const STEPS: ReadonlyArray<{ status: DeliveryStatus; label: string }> = [
  { status: 'Booked', label: 'Booked' },
  { status: 'Assigned', label: 'Assigned' },
  { status: 'PickedUp', label: 'Picked' },
  { status: 'InTransit', label: 'Transit' },
  { status: 'Delivered', label: 'Delivered' },
]

const PASSED_COLOUR: Record<string, string> = {
  Booked: 'bg-booked',
  Assigned: 'bg-assigned',
  PickedUp: 'bg-picked',
  InTransit: 'bg-transit',
  Delivered: 'bg-delivered',
}

interface Props {
  status: DeliveryStatus
  /**
   * True only while real-time updates are arriving. Omitted on screens with no
   * socket at all (the agent card), where a static rail is the honest render.
   */
  live?: boolean
  labels?: boolean
}

export const LifecycleRail = ({ status, live = false, labels = false }: Props) => {
  /**
   * Cancelled and Failed leave the path rather than advancing along it, so the
   * rail shows how far the parcel actually got.
   */
  const reached =
    status === 'Failed'
      ? STEPS.findIndex((s) => s.status === 'InTransit')
      : status === 'Cancelled'
        ? STEPS.findIndex((s) => s.status === 'Assigned')
        : STEPS.findIndex((s) => s.status === status)

  const finished =
    status === 'Delivered' || status === 'Cancelled' || status === 'Failed'

  return (
    <div>
      <div
        className="flex gap-1"
        role="img"
        aria-label={`Progress: ${status}${live ? ', live' : ''}`}
      >
        {STEPS.map((step, i) => {
          const passed = i < reached
          const current = i === reached
          const colour = passed
            ? (PASSED_COLOUR[step.status] ?? 'bg-surface-sunk')
            : current
              ? finished
                ? (PASSED_COLOUR[step.status] ?? 'bg-surface-sunk')
                : 'bg-accent'
              : 'bg-surface-sunk'

          // Only the in-progress segment can shimmer, and only when live.
          const isLiveSegment = current && !finished

          return (
            <span
              key={step.status}
              className={`h-[5px] flex-1 rounded-pill ${colour}${isLiveSegment ? ' rail-live' : ''}`}
              {...(isLiveSegment ? { 'data-live': String(live) } : {})}
            />
          )
        })}
      </div>

      {labels ? (
        <div className="flex mt-9px">
          {STEPS.map((step, i) => (
            <span
              key={step.status}
              className={[
                'flex-1 text-[10.5px] font-medium',
                i === reached && !finished
                  ? 'text-transit'
                  : i <= reached
                    ? 'text-ink-2'
                    : 'text-faint',
              ].join(' ')}
            >
              {step.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
