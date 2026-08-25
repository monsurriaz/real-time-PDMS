import type { DeliveryStatus } from '@pdms/shared'

/**
 * The status pill from docs/design-system-v3-meridian.html — `.badge` plus its
 * `.b-*` variant, including the 5.5px dot.
 *
 * v3 draws seven badges and the lifecycle has seven states, but they are not
 * the same seven: v3's seventh is `pending` (a rider awaiting approval, not a
 * parcel), and Cancelled shares Booked's neutral grey. That sharing is
 * deliberate — a cancelled parcel is inert, not failed, so borrowing the red
 * would misreport it — and `cancelled-*` exists as its own token name so the
 * two are separable without touching this file.
 */
const VARIANT: Record<DeliveryStatus, string> = {
  Booked: 'bg-booked-bg text-booked-ink',
  Assigned: 'bg-assigned-bg text-assigned-ink',
  PickedUp: 'bg-picked-bg text-picked-ink',
  InTransit: 'bg-transit-bg text-transit-ink',
  Delivered: 'bg-delivered-bg text-delivered-ink',
  Cancelled: 'bg-cancelled-bg text-cancelled-ink',
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

const SHELL =
  'inline-flex items-center gap-6px rounded-pill py-1 pr-11px pl-9px text-meta font-medium whitespace-nowrap'

export const Badge = ({ status }: { status: DeliveryStatus }) => (
  <span className={`${SHELL} ${VARIANT[status]}`}>
    <i className="w-[5.5px] h-[5.5px] rounded-full bg-current flex-none" />
    {LABEL[status]}
  </span>
)

/**
 * The same pill for things that are not parcel states — a count in the header,
 * a rider awaiting approval. Kept beside Badge so both read from one set of
 * variant classes rather than each screen assembling pill styles by hand.
 */
type ToneName = 'booked' | 'transit' | 'delivered' | 'failed' | 'pending'

const TONE: Record<ToneName, string> = {
  booked: 'bg-booked-bg text-booked-ink',
  transit: 'bg-transit-bg text-transit-ink',
  delivered: 'bg-delivered-bg text-delivered-ink',
  failed: 'bg-failed-bg text-failed-ink',
  pending: 'bg-pending-bg text-pending-ink',
}

export const Pill = ({
  tone,
  children,
  dot = true,
}: {
  tone: ToneName
  children: React.ReactNode
  dot?: boolean
}) => (
  <span className={`${SHELL} ${TONE[tone]}`}>
    {dot ? <i className="w-[5.5px] h-[5.5px] rounded-full bg-current flex-none" /> : null}
    {children}
  </span>
)
