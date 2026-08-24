import type { DeliveryStatus } from '@pdms/shared'

/**
 * The status pill from docs/design-system.html — `.badge` plus its `.b-*`
 * variant, including the 6px dot. Padding, gap, size and radius are the
 * reference's own values, expressed through spacing tokens.
 *
 * The design system defines six variants and the lifecycle has seven states:
 * there is no `.b-cancelled`. Cancelled reuses the neutral grey of Booked,
 * which is the only defensible choice in the existing palette — a cancelled
 * parcel is inert, not failed, so borrowing the red would misreport it.
 */
const VARIANT: Record<DeliveryStatus, string> = {
  Booked: 'bg-booked-bg text-booked-ink',
  Assigned: 'bg-assigned-bg text-assigned-ink',
  PickedUp: 'bg-picked-bg text-picked-ink',
  InTransit: 'bg-transit-bg text-transit-ink',
  Delivered: 'bg-delivered-bg text-delivered-ink',
  Cancelled: 'bg-booked-bg text-booked-ink',
  Failed: 'bg-failed-bg text-failed-ink',
}

/** Lifecycle names are PascalCase in the domain; people read them spaced. */
const LABEL: Record<DeliveryStatus, string> = {
  Booked: 'Booked',
  Assigned: 'Assigned',
  PickedUp: 'Picked up',
  InTransit: 'In transit',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
  Failed: 'Failed',
}

interface Props {
  status: DeliveryStatus
}

export const Badge = ({ status }: Props) => (
  <span
    className={[
      'inline-flex items-center gap-7px rounded-pill',
      'py-5px pr-3 pl-10px text-[12.5px] font-medium',
      VARIANT[status],
    ].join(' ')}
  >
    <i className="w-1.5 h-1.5 rounded-full bg-current flex-none" />
    {LABEL[status]}
  </span>
)
