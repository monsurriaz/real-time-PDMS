import type { DeliveryStatus } from '@pdms/shared'

/**
 * The `.rail` from docs/design-system-v3-meridian.html — five 4px pill
 * segments with a 3px gap, one per step of the happy path, optionally with
 * labels underneath. Two variants, per the v3.1 addendum:
 *
 * `rail="full"` (default) — the five discrete segments, for detail views,
 * agent cards, and the landing showcase, where there's room for each stage
 * to be its own object.
 *
 * `rail="compact"` — one continuous track filled to the current stage and
 * coloured by it. At the ~86px a table row affords, five segments with 3px
 * gaps become 14px dashes that read as an ellipsis rather than progress —
 * a real legibility failure in the busiest place the component appears — so
 * every table row uses this variant instead. `labels` has no effect here;
 * there is no room under a single track for a second row of text.
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
  /** `full` (default) or `compact` — see the file header. */
  rail?: 'full' | 'compact'
}

export const LifecycleRail = ({ status, live = false, labels = false, rail = 'full' }: Props) => {
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

  /**
   * The colour and liveness of the CURRENT position — the one segment (full)
   * or the one fill (compact) that answers "where is it now". Shared between
   * both variants so they can never colour the same status two different
   * ways.
   */
  const currentStep = STEPS[reached]
  const currentColour = finished
    ? (currentStep ? PASSED_COLOUR[currentStep.status] ?? 'bg-surface-sunk' : 'bg-surface-sunk')
    : 'bg-accent'
  const isLiveSegment = !finished

  const ariaLabel = `Progress: ${status}${live ? ', live' : ''}`

  if (rail === 'compact') {
    // How far along the five-step happy path the parcel has got, as a
    // fraction of the whole track — one continuous fill, not five segments.
    const pct = Math.max(0, Math.min(100, ((reached + 1) / STEPS.length) * 100))
    return (
      <div
        className={`h-6px rounded-pill bg-border overflow-hidden relative${isLiveSegment ? ' rail-live' : ''}`}
        role="img"
        aria-label={ariaLabel}
        {...(isLiveSegment ? { 'data-live': String(live) } : {})}
      >
        <div className={`h-full rounded-pill ${currentColour}`} style={{ width: `${pct}%` }} />
      </div>
    )
  }

  return (
    <div>
      <div className="flex gap-3px" role="img" aria-label={ariaLabel}>
        {STEPS.map((step, i) => {
          const passed = i < reached
          const current = i === reached
          const colour = passed
            ? (PASSED_COLOUR[step.status] ?? 'bg-surface-sunk')
            : current
              ? currentColour
              : 'bg-surface-sunk'

          // Only the in-progress segment can shimmer, and only when live.
          const isLiveCurrentSegment = current && isLiveSegment

          return (
            <span
              key={step.status}
              className={`h-1 flex-1 rounded-pill ${colour}${isLiveCurrentSegment ? ' rail-live' : ''}`}
              {...(isLiveCurrentSegment ? { 'data-live': String(live) } : {})}
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
                // 10px in v3, the smallest text in the system, and only ever
                // under a rail where the segment above carries the meaning.
                'flex-1 text-rail font-medium',
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
