import type { DeliveryStatus } from '@pdms/shared'

/**
 * The `.rail` from docs/design-system.html — five 5px pill segments with a 4px
 * gap, one per step of the happy path.
 *
 * Steps already passed carry their own lifecycle colour, the current one is
 * accent because orange means "moving" (CLAUDE.md section 4), and the rest are
 * surface-sunk.
 *
 * The reference animates the live segment with a `linear-gradient` shimmer.
 * That is not reproduced: section 4 forbids gradients, and the shimmer is
 * decoration — the solid segments carry the same information.
 */

/** The happy path, in order. Terminal side-exits are not rail positions. */
const STEPS: readonly DeliveryStatus[] = [
  'Booked',
  'Assigned',
  'PickedUp',
  'InTransit',
  'Delivered',
]

const PASSED_COLOUR: Record<string, string> = {
  Booked: 'bg-booked',
  Assigned: 'bg-assigned',
  PickedUp: 'bg-picked',
  InTransit: 'bg-transit',
  Delivered: 'bg-delivered',
}

export const LifecycleRail = ({ status }: { status: DeliveryStatus }) => {
  /**
   * Cancelled and Failed leave the path rather than advancing along it, so the
   * rail shows how far the parcel actually got. Failed can only happen from
   * InTransit and Cancelled only before pickup, but the rail does not need to
   * know that — only the furthest step reached.
   */
  const reached =
    status === 'Failed'
      ? STEPS.indexOf('InTransit')
      : status === 'Cancelled'
        ? STEPS.indexOf('Assigned')
        : STEPS.indexOf(status)

  const finished =
    status === 'Delivered' || status === 'Cancelled' || status === 'Failed'

  return (
    <div className="flex gap-1" role="img" aria-label={`Progress: ${status}`}>
      {STEPS.map((step, i) => {
        const colour =
          i < reached
            ? (PASSED_COLOUR[step] ?? 'bg-surface-sunk')
            : i === reached
              ? // Nothing is moving on a finished parcel, so its last segment
                // shows its own colour rather than "in motion" orange.
                finished
                ? (PASSED_COLOUR[step] ?? 'bg-surface-sunk')
                : 'bg-accent'
              : 'bg-surface-sunk'

        return <span key={step} className={`h-[5px] flex-1 rounded-pill ${colour}`} />
      })}
    </div>
  )
}
