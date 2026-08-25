import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  advanceStatusInputSchema,
  deliveryStatusSchema,
  zoneName,
  type DeliveryStatus,
  type ParcelListItem,
  type PaymentSummary,
} from '@pdms/shared'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { LifecycleRail } from '@/components/LifecycleRail'
import {
  FilterBar,
  Pager,
  SelectFilter,
  TableScroll,
  Td,
  Thead,
  Tr,
  paginate,
} from '@/components/Table'
import { useSearchable } from '@/features/shell/useHeaderSearch'
import { ApiError } from '@/lib/api'
import { WelcomeNotice } from '../auth/WelcomeNotice'
import { formatDateTime, formatKg, formatTaka } from '@/lib/format'
import { useParcels } from '../booking/useBooking'
import { useAdvanceStatus } from '../deliveries/useDeliveries'
import { useStartCheckout } from '../payments/usePayments'

/**
 * The customer's parcels, as a v3 data table: filter bar, lifecycle rail in
 * the row, per-row actions, pagination.
 *
 * Every number is in the mono face with tabular figures, so the price and
 * weight columns line up down the list.
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
      <span role="alert" className="text-tiny text-failed-ink">
        {advance.error instanceof ApiError ? advance.error.message : 'Could not cancel'}
      </span>
    )
  }

  return armed ? (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
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
        className="text-meta text-muted hover:text-ink"
      >
        Keep
      </button>
    </span>
  ) : (
    <Button size="sm" onClick={() => setArmed(true)} aria-label={`Cancel ${trackingId}`}>
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
  if (!payment) return <span className="text-tiny text-muted">—</span>

  const key = `${payment.method}:${payment.status}`
  const label = PAYMENT_LABEL[key] ?? payment.status

  return (
    <div>
      <span
        className={[
          'text-small',
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
          <span className="block text-eyebrow text-faint">confirming…</span>
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
            className="text-meta font-medium text-accent hover:text-accent-hover mt-0.5"
          >
            {checkout.isPending ? 'Opening…' : 'Pay now'}
          </button>
        </>
      ) : null}
      {checkout.isError ? (
        <span role="alert" className="block text-eyebrow text-failed-ink">
          {checkout.error instanceof ApiError
            ? checkout.error.message
            : 'Could not open checkout'}
        </span>
      ) : null}
      {payment.method === 'card' && payment.status === 'failed' ? (
        <span className="block text-eyebrow text-faint mono">
          {formatTaka(payment.amount)} due
        </span>
      ) : null}
    </div>
  )
}

/**
 * The strip shown when a booking lands back on this screen.
 *
 * One component for both arrival paths — the COD booking that never sees a
 * checkout page, and the return from Stripe — because they are the same
 * question ("did that work?") and the honest answer comes from the parcel's
 * ACTUAL state rather than from the query string. `?payment=success` only means
 * the customer got through the form: a COD parcel was never paid at all, and a
 * card payment is not confirmed until the webhook lands, which may be a second
 * or two behind. So the copy is chosen from the row, not from the URL.
 *
 * The params are read ONCE, on mount, and the URL is cleaned immediately
 * afterwards — a refresh must not re-announce a booking from ten minutes ago.
 */
const BookingReturn = ({ rows }: { rows: readonly ParcelListItem[] }) => {
  const [params, setParams] = useSearchParams()

  /**
   * Captured in state on first render, before the effect below strips the
   * params. Reading them straight from `params` at render time would make the
   * banner vanish the instant the URL is cleaned.
   */
  const [claim] = useState<{
    outcome: 'success' | 'cancelled'
    parcelId: string | null
  } | null>(() => {
    const outcome = params.get('payment')
    if (outcome !== 'success' && outcome !== 'cancelled') return null
    return { outcome, parcelId: params.get('parcel') }
  })
  const [dismissed, setDismissed] = useState(false)

  /**
   * `setSearchParams(..., { replace: true })` rather than a bare
   * history.replaceState: it performs the same replaceState underneath, but
   * keeps react-router's own idea of the location in step — a raw call leaves
   * every other useSearchParams in the tree reading a URL that is no longer in
   * the address bar.
   */
  useEffect(() => {
    if (!params.has('payment') && !params.has('parcel')) return
    const next = new URLSearchParams(params)
    next.delete('payment')
    next.delete('parcel')
    setParams(next, { replace: true })
  }, [params, setParams])

  if (!claim || dismissed) return null

  const parcel = claim.parcelId ? rows.find((p) => p._id === claim.parcelId) : undefined

  const message = ((): { tone: 'good' | 'quiet' | 'bad'; text: string } => {
    if (claim.outcome === 'cancelled') {
      return {
        tone: 'quiet',
        text: 'Payment cancelled. Your parcel is still booked — you can pay for it from the list below.',
      }
    }

    // The list has not arrived yet, or names no such parcel. The booking
    // itself is the one thing we do know happened.
    if (!parcel) return { tone: 'good', text: 'Parcel booked.' }

    const named = ` ${parcel.trackingId}`

    if (parcel.isCod) {
      return {
        tone: 'good',
        text: `Parcel booked —${named}. The rider collects ${formatTaka(parcel.codAmount)} in cash at the door.`,
      }
    }

    if (parcel.payment?.status === 'paid') {
      return { tone: 'good', text: `Payment confirmed for${named}.` }
    }

    if (parcel.payment?.status === 'failed') {
      return {
        tone: 'bad',
        text: `Parcel${named} is booked, but the payment did not go through. You can retry it from the row below.`,
      }
    }

    return {
      tone: 'good',
      text: `Parcel booked —${named}. We are confirming the payment with the provider; the row below updates itself.`,
    }
  })()

  return (
    <div
      role="status"
      className={[
        'flex items-start justify-between gap-4 rounded-md px-4 py-3 mb-5 text-sm',
        message.tone === 'good'
          ? 'bg-delivered-bg text-delivered-ink'
          : message.tone === 'bad'
            ? 'bg-failed-bg text-failed-ink'
            : 'bg-surface-sunk text-ink-2',
      ].join(' ')}
    >
      <p>{message.text}</p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-meta font-medium underline decoration-current/40 hover:decoration-current flex-none"
      >
        Dismiss
      </button>
    </div>
  )
}

const PER_PAGE = 8

export const ParcelList = () => {
  const parcels = useParcels()
  // Claims the header's search box for this screen — v3.1 addendum. Real
  // client-side filtering over rows already fetched by useParcels above,
  // not a new endpoint.
  const search = useSearchable('Search tracking ID or address…')
  const [status, setStatus] = useState<DeliveryStatus | ''>('')
  const [zone, setZone] = useState<string>('')
  const [page, setPage] = useState(1)

  const rows = useMemo(() => {
    const all = parcels.data ?? []
    const q = search.trim().toLowerCase()
    return all.filter(
      (p) =>
        (status === '' || p.status === status) &&
        (zone === '' || p.dropArea.includes(zone) || p.pickupArea.includes(zone)) &&
        (q === '' ||
          p.trackingId.toLowerCase().includes(q) ||
          p.pickupArea.toLowerCase().includes(q) ||
          p.dropArea.toLowerCase().includes(q)),
    )
  }, [parcels.data, status, zone, search])

  /**
   * Rendered in every branch below, the loading one included: a customer
   * arriving straight from a booking should see it confirmed while the list is
   * still in flight, and the copy sharpens on its own once the row it names
   * turns up.
   */
  const banner = (
    <>
      {/* Once per account, on the screen a new customer lands on. */}
      <WelcomeNotice>
        <p className="font-semibold text-ink">Welcome to ParcelDelivery.</p>
        <p className="mt-0.5">
          Book a parcel and you can watch the rider move on a live map from the
          moment one is assigned.
        </p>
      </WelcomeNotice>
      <BookingReturn rows={parcels.data ?? []} />
    </>
  )

  if (parcels.isPending) {
    return (
      <>
        {banner}
        <Card>
          <p className="text-body text-muted">Loading your parcels…</p>
        </Card>
      </>
    )
  }

  if (parcels.isError) {
    return (
      <>
        {banner}
        <Card>
          <p
            role="alert"
            className="text-sm text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2"
          >
            {parcels.error instanceof ApiError
              ? parcels.error.message
              : 'Your parcels could not be loaded.'}
          </p>
        </Card>
      </>
    )
  }

  if ((parcels.data ?? []).length === 0) {
    return (
      <>
        {banner}
        <Card>
          <p className="text-body text-muted mb-4">You have not booked anything yet.</p>
          <Link to="/customer/book">
            <Button variant="primary">Book a parcel</Button>
          </Link>
        </Card>
      </>
    )
  }

  const view = paginate(rows, page, PER_PAGE)

  return (
    <>
      {banner}
      <Card pad={false}>
        <FilterBar>
          <SelectFilter
            label="All statuses"
            value={status}
            onChange={(next) => {
              setStatus(next)
              setPage(1)
            }}
            options={deliveryStatusSchema.options.map((s) => ({ value: s, label: s }))}
          />
          <SelectFilter
            label="All zones"
            value={zone}
            onChange={(next) => {
              setZone(next)
              setPage(1)
            }}
            options={zoneName.options.map((z) => ({ value: z, label: z }))}
          />
          <Link to="/customer/book" className="ml-auto inline-flex">
            <Button variant="primary" size="sm">
              Book a parcel
            </Button>
          </Link>
        </FilterBar>

        {rows.length === 0 ? (
          <div className="px-18px py-8 text-center">
            <p className="text-body text-muted">
              No parcel matches those filters.{' '}
              <button
                type="button"
                onClick={() => {
                  setStatus('')
                  setZone('')
                }}
                className="text-accent font-medium hover:text-accent-hover"
              >
                Clear them
              </button>
              .
            </p>
          </div>
        ) : (
          <TableScroll min={860}>
            <Thead
              cols={['Tracking', 'Route', 'Progress', 'Weight', 'Price', 'Payment', 'Booked', '']}
            />
            <tbody>
              {view.slice.map((p) => (
                <Tr key={p._id}>
                  <Td>
                    {/* Tracking is the point of the app — make the ID the way in. */}
                    <Link
                      to={`/customer/track/${p._id}`}
                      className="mono text-small font-medium hover:text-accent whitespace-nowrap inline-flex items-center min-h-6"
                    >
                      {p.trackingId}
                    </Link>
                  </Td>
                  <Td className="text-ink-2">
                    {p.pickupArea} → {p.dropArea}
                  </Td>
                  <Td>
                    {/*
                      Compact: at this 86px width, five discrete segments read
                      as an ellipsis rather than progress (v3.1 addendum).
                    */}
                    <div className="w-[86px]">
                      <LifecycleRail status={asStatus(p.status)} rail="compact" />
                    </div>
                    <span className="sr-only">{p.status}</span>
                  </Td>
                  <Td>
                    <span className="mono text-small">{formatKg(p.weightKg)}</span>
                  </Td>
                  <Td>
                    <span className="mono text-small">{formatTaka(p.total)}</span>
                    {p.isCod ? (
                      <span className="block text-eyebrow text-faint mono">
                        COD {formatTaka(p.codAmount)}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <PaymentCell parcelId={p._id} payment={p.payment} />
                  </Td>
                  <Td>
                    <span className="mono text-meta text-muted">
                      {formatDateTime(p.createdAt)}
                    </span>
                  </Td>
                  <Td align="right">
                    {/*
                      Cancel is offered only where the server says it is legal —
                      before pickup. It re-checks when clicked (rule 3).
                    */}
                    {p.deliveryId && p.allowedTransitions.includes('Cancelled') ? (
                      <CancelButton deliveryId={p.deliveryId} trackingId={p.trackingId} />
                    ) : (
                      <Link to={`/customer/track/${p._id}`} className="inline-flex">
                        <Button size="sm">Track</Button>
                      </Link>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableScroll>
        )}

        <Pager
          page={view.page}
          pageCount={view.pageCount}
          total={rows.length}
          from={view.from}
          to={view.to}
          onPage={setPage}
        />
      </Card>
    </>
  )
}
