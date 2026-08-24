import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  advanceStatusInputSchema,
  deliveryStatusSchema,
  type DeliveryStatus,
  type PaymentSummary,
} from '@pdms/shared'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { Panel } from '@/components/Panel'
import { ApiError } from '@/lib/api'
import { formatDateTime, formatKg, formatTaka } from '@/lib/format'
import { useParcels } from '../booking/useBooking'
import { useAdvanceStatus } from '../deliveries/useDeliveries'
import { useStartCheckout } from '../payments/usePayments'

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
        onClick={() => {
          // Validated with the same schema the server uses (rule 4); the
          // server re-validates and re-checks authority regardless.
          const parsed = advanceStatusInputSchema.safeParse({
            to: 'Cancelled',
            note: 'Cancelled by customer',
          })
          if (!parsed.success) return
          advance.mutate({ deliveryId, ...parsed.data })
        }}
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
 * Where one parcel's money stands, in words rather than a raw enum.
 *
 * COD and card share this column because the customer's question is the same
 * either way — "have I paid, and if not, what happens?" — even though the
 * answer arrives from a webhook in one case and a rider's pocket in the other.
 */
const PAYMENT_LABEL: Record<string, string> = {
  'card:pending': 'Awaiting payment',
  'card:paid': 'Paid',
  'card:failed': 'Payment failed',
  'card:refunded': 'Refunded',
  'cod:pending': 'Cash on delivery',
  'cod:collected': 'Cash collected',
  'cod:settled': 'Cash collected',
  'cod:failed': 'Not collected',
}

const PaymentCell = ({
  parcelId,
  payment,
}: {
  parcelId: string
  payment: PaymentSummary | null
}) => {
  const checkout = useStartCheckout()

  // Parcels booked before M5 have no ledger row. Saying so beats inventing one.
  if (!payment) return <span className="text-[11.5px] text-faint">—</span>

  const key = `${payment.method}:${payment.status}`
  const label = PAYMENT_LABEL[key] ?? payment.status
  const owes = payment.method === 'card' && payment.status !== 'paid'

  return (
    <div>
      <span
        className={[
          'text-[12.5px]',
          payment.status === 'paid' || payment.status === 'settled'
            ? 'text-delivered-ink font-medium'
            : payment.status === 'failed'
              ? 'text-failed-ink'
              : 'text-ink-2',
        ].join(' ')}
      >
        {label}
      </span>
      {payment.method === 'card' && payment.status === 'pending' ? (
        <>
          {/* The webhook has not landed yet. Said plainly rather than shown as
              a spinner, because it may never land if the customer walked away. */}
          <span className="block text-[11px] text-faint">confirming…</span>
          <button
            type="button"
            disabled={checkout.isPending}
            onClick={() =>
              checkout.mutate(parcelId, {
                onSuccess: (session) => {
                  window.location.href = session.url
                },
              })
            }
            className="text-[12px] font-medium text-ink underline decoration-hairline-strong hover:decoration-ink mt-0.5"
          >
            {checkout.isPending ? 'Opening…' : 'Pay now'}
          </button>
        </>
      ) : null}
      {checkout.isError ? (
        <span role="alert" className="block text-[11px] text-failed-ink">
          {checkout.error instanceof ApiError
            ? checkout.error.message
            : 'Could not open checkout'}
        </span>
      ) : null}
      {owes && payment.status === 'failed' ? (
        <span className="block text-[11px] text-faint mono">
          {formatTaka(payment.amount)} due
        </span>
      ) : null}
    </div>
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

/**
 * The strip shown on return from the hosted checkout page.
 *
 * Success here means the customer completed the payment form, NOT that the money
 * has been confirmed — that is the webhook's job and it may be a second or two
 * behind. Saying "confirming" rather than "paid" is the honest version, and the
 * row below updates itself when the webhook lands.
 */
const CheckoutReturn = () => {
  const [params, setParams] = useSearchParams()
  const outcome = params.get('payment')
  if (outcome !== 'success' && outcome !== 'cancelled') return null

  const dismiss = (): void => {
    const next = new URLSearchParams(params)
    next.delete('payment')
    next.delete('parcel')
    setParams(next, { replace: true })
  }

  return (
    <div
      className={[
        'flex items-start justify-between gap-4 rounded-md px-4 py-3 mb-5 text-[13px]',
        outcome === 'success'
          ? 'bg-delivered-bg text-delivered-ink'
          : 'bg-surface-sunk text-ink-2',
      ].join(' ')}
    >
      <p>
        {outcome === 'success'
          ? 'Payment submitted. We are confirming it with the payment provider — the row below updates itself.'
          : 'Payment cancelled. Your parcel is still booked; you can pay from the list below.'}
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="text-[12px] font-medium underline decoration-current/40 hover:decoration-current flex-none"
      >
        Dismiss
      </button>
    </div>
  )
}

export const ParcelList = () => {
  const parcels = useParcels()

  if (parcels.isPending) {
    return (
      <Panel>
        <p className="text-body text-muted">Loading your parcels…</p>
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
        <p className="text-body text-muted mb-4">
          You have not booked anything yet.
        </p>
        <Link to="/book">
          <Button variant="primary">Book a parcel</Button>
        </Link>
      </Panel>
    )
  }

  return (
    <>
      <CheckoutReturn />
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
          <table className="w-full border-collapse min-w-[760px]">
            <thead>
              <tr>
                {['Tracking', 'Route', 'Weight', 'Status', 'Price', 'Payment', 'Booked', ''].map((h) => (
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
                    {/* Tracking is the point of the app — make the ID the way in. */}
                    <Link
                      to={`/track/${p._id}`}
                      className="mono text-[12.5px] font-medium underline decoration-hairline-strong hover:decoration-ink"
                    >
                      {p.trackingId}
                    </Link>
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
                    <span className="mono text-body">{formatTaka(p.total)}</span>
                    {p.isCod ? (
                      <span className="block text-[11px] text-faint mono">
                        COD {formatTaka(p.codAmount)}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3 pr-4">
                    <PaymentCell parcelId={p._id} payment={p.payment} />
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
    </>
  )
}
