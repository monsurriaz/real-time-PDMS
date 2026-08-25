import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  bookParcelInputSchema,
  heaviestPricedKg,
  parcelSizeSchema,
  type BookParcelInput,
  type ParcelSize,
  type ZoneName,
} from '@pdms/shared'
import { Button } from '@/components/Button'
import { Field, SelectField } from '@/components/Field'
import { Card, Eyebrow, KeyValue } from '@/components/Card'
import { ApiError } from '@/lib/api'
import { formatKm, formatTaka } from '@/lib/format'
import { usePaymentConfig, useStartCheckout } from '../payments/usePayments'
import { usePricing, useZones } from '../pricing/usePricing'
import {
  asLookupProblem,
  useBookParcel,
  useQuote,
  type QuoteResult,
} from './useBooking'

/**
 * Booking, in two steps: fill the form, then see a real quote before
 * committing. The quote step exists because geocoding and distance are real
 * lookups — the customer should see what they will be charged, and the
 * resolved addresses, before a parcel exists.
 */

type Draft = {
  pickupLine1: string
  pickupArea: string
  pickupZone: ZoneName | ''
  senderName: string
  senderPhone: string
  dropLine1: string
  dropArea: string
  dropZone: ZoneName | ''
  recipientName: string
  recipientPhone: string
  weightKg: string
  size: ParcelSize
  description: string
  isCod: boolean
}

const EMPTY: Draft = {
  pickupLine1: '', pickupArea: '', pickupZone: '',
  senderName: '', senderPhone: '',
  dropLine1: '', dropArea: '', dropZone: '',
  recipientName: '', recipientPhone: '',
  weightKg: '1', size: 'small', description: '',
  isCod: false,
}

/** Draft (all strings, as the DOM gives them) -> the shared booking schema. */
const toPayload = (d: Draft): unknown => ({
  pickup: {
    line1: d.pickupLine1, area: d.pickupArea, zone: d.pickupZone, city: 'Dhaka',
    contactName: d.senderName, contactPhone: d.senderPhone,
  },
  drop: {
    line1: d.dropLine1, area: d.dropArea, zone: d.dropZone, city: 'Dhaka',
    contactName: d.recipientName, contactPhone: d.recipientPhone,
  },
  weightKg: Number(d.weightKg),
  size: d.size,
  ...(d.description ? { description: d.description } : {}),
  isCod: d.isCod,
})

type Errors = Record<string, string>

/**
 * Validated with the same schema the server uses (CLAUDE.md rule 4). The
 * server re-validates regardless — this only spares the customer a round trip.
 */
const validate = (d: Draft): { ok: true; value: BookParcelInput } | { ok: false; errors: Errors } => {
  const parsed = bookParcelInputSchema.safeParse(toPayload(d))
  if (parsed.success) return { ok: true, value: parsed.data }
  const errors: Errors = {}
  for (const issue of parsed.error.issues) errors[issue.path.join('.')] ??= issue.message
  return { ok: false, errors }
}

/**
 * Where a completed booking lands, whichever way it was paid for.
 *
 * One destination and one query shape for both paths — the COD booking that
 * never sees a checkout page, and the return from Stripe — because the banner
 * on the other end reads the parcel's ACTUAL state to decide what to say. Two
 * URLs would mean two implementations of the same "did that work?" answer, and
 * the redirect after a COD booking used to go somewhere else entirely (`/`),
 * which is how it ended up on a page that read neither.
 *
 * Kept identical to the `successUrl` the server hands Stripe in
 * services/payments.ts. If one moves, the other has to.
 */
export const bookedPath = (parcelId: string): string =>
  `/customer/parcels?payment=success&parcel=${parcelId}`

export const BookingPage = () => {
  const navigate = useNavigate()
  const zones = useZones()
  const pricing = usePricing()
  const paymentConfig = usePaymentConfig()
  const quote = useQuote()
  const book = useBookParcel()
  const checkout = useStartCheckout()

  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [confirmed, setConfirmed] = useState<QuoteResult | null>(null)

  const set = <K extends keyof Draft>(k: K, v: Draft[K]): void => {
    setDraft((d) => ({ ...d, [k]: v }))
    // A quote describes the addresses as they were; editing invalidates it.
    setConfirmed(null)
  }

  const zoneOptions = zones.data ?? []

  /**
   * The zone list is the one piece of reference data this form cannot work
   * without, and a select that is simply empty gives no clue why. Loading and
   * failure are said out loud on the control itself rather than left to the
   * customer to infer from an empty dropdown.
   */
  const zoneHint = zones.isPending
    ? 'Loading zones…'
    : zones.isError
      ? 'Zones could not be loaded — reload the page to try again.'
      : zoneOptions.length === 0
        ? 'No serviceable zones are configured yet.'
        : null
  const zoneProblem = zones.isError || (!zones.isPending && zoneOptions.length === 0)

  /**
   * The heaviest parcel the current tiers price.
   *
   * Read from the live PricingConfig rather than written here: an admin can
   * raise the ceiling from the pricing editor with no deploy, so a constant in
   * this file would start lying the moment they did. Stating it BEFORE submit is
   * the point — the old behaviour was a 422 after the customer had filled in
   * two addresses, which is a dead end however honest the message.
   */
  const maxKg = pricing.data ? heaviestPricedKg(pricing.data.weightTiers) : null
  const enteredKg = Number(draft.weightKg)
  const overWeight =
    maxKg !== null && Number.isFinite(enteredKg) && enteredKg > maxKg

  const requestQuote = (e: React.FormEvent): void => {
    e.preventDefault()
    const result = validate(draft)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    quote.mutate(result.value, { onSuccess: (q) => setConfirmed(q) })
  }

  /**
   * Book, then pay.
   *
   * Two steps rather than one because they can fail independently: the parcel
   * exists and is assigned the moment booking succeeds, and a customer who
   * abandons the payment page has a real parcel with a pending payment — not a
   * lost booking. That is also why nothing in the lifecycle waits on payment.
   *
   * A COD parcel skips checkout entirely: the rider collects at the door.
   */
  const confirm = (): void => {
    const result = validate(draft)
    if (!result.ok) return

    book.mutate(result.value, {
      onSuccess: (booked) => {
        const payOnline =
          !booked.parcel.isCod && paymentConfig.data?.cardPayments === true
        if (!payOnline) {
          navigate(bookedPath(booked.parcel._id), { replace: true })
          return
        }
        checkout.mutate(booked.parcel._id, {
          // A hosted checkout page, so this leaves the SPA on purpose.
          onSuccess: (session) => {
            window.location.href = session.url
          },
          // The parcel is booked either way. Land on the list, where the row
          // says the payment is still pending and offers to retry it.
          onError: () => navigate(bookedPath(booked.parcel._id), { replace: true }),
        })
      },
    })
  }

  const problem = asLookupProblem(quote.error) ?? asLookupProblem(book.error)
  const otherError =
    !problem && (quote.error ?? book.error) instanceof ApiError
      ? ((quote.error ?? book.error) as ApiError).message
      : null

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px] items-start">
      <form onSubmit={requestQuote} noValidate className="grid gap-5">
        <Card title="Pick-up">
          <Field
            label="Road / house"
            placeholder="Road 27"
            value={draft.pickupLine1}
            error={errors['pickup.line1']}
            onChange={(e) => set('pickupLine1', e.target.value)}
          />
          <Field
            label="Area"
            placeholder="Dhanmondi"
            value={draft.pickupArea}
            error={errors['pickup.area']}
            onChange={(e) => set('pickupArea', e.target.value)}
          />
          <SelectField
            label="Zone"
            value={draft.pickupZone}
            error={zoneProblem ? zoneHint : errors['pickup.zone']}
            hint={zoneHint ?? 'The zone base fare is taken from the pick-up zone.'}
            disabled={zones.isPending}
            onChange={(e) => set('pickupZone', e.target.value as ZoneName | '')}
          >
            <option value="">
              {zones.isPending ? 'Loading zones…' : 'Select a zone'}
            </option>
            {zoneOptions.map((z) => (
              <option key={z.name} value={z.name}>{z.label}</option>
            ))}
          </SelectField>
          <Field
            label="Sender name"
            value={draft.senderName}
            error={errors['pickup.contactName']}
            onChange={(e) => set('senderName', e.target.value)}
          />
          <Field
            label="Sender phone"
            placeholder="01711000001"
            inputMode="tel"
            value={draft.senderPhone}
            error={errors['pickup.contactPhone']}
            onChange={(e) => set('senderPhone', e.target.value)}
          />
        </Card>

        <Card title="Drop-off">
          <Field
            label="Road / house"
            placeholder="Gulshan Avenue"
            value={draft.dropLine1}
            error={errors['drop.line1']}
            onChange={(e) => set('dropLine1', e.target.value)}
          />
          <Field
            label="Area"
            placeholder="Gulshan 1"
            value={draft.dropArea}
            error={errors['drop.area']}
            onChange={(e) => set('dropArea', e.target.value)}
          />
          <SelectField
            label="Zone"
            value={draft.dropZone}
            error={zoneProblem ? zoneHint : errors['drop.zone']}
            {...(zoneHint && !zoneProblem ? { hint: zoneHint } : {})}
            disabled={zones.isPending}
            onChange={(e) => set('dropZone', e.target.value as ZoneName | '')}
          >
            <option value="">
              {zones.isPending ? 'Loading zones…' : 'Select a zone'}
            </option>
            {zoneOptions.map((z) => (
              <option key={z.name} value={z.name}>{z.label}</option>
            ))}
          </SelectField>
          <Field
            label="Recipient name"
            value={draft.recipientName}
            error={errors['drop.contactName']}
            onChange={(e) => set('recipientName', e.target.value)}
          />
          <Field
            label="Recipient phone"
            placeholder="01711000002"
            inputMode="tel"
            value={draft.recipientPhone}
            error={errors['drop.contactPhone']}
            onChange={(e) => set('recipientPhone', e.target.value)}
          />
        </Card>

        <Card title="Parcel">
          <div className="grid sm:grid-cols-2 gap-x-5">
            <Field
              label="Weight"
              type="number"
              min={0.1}
              step={0.1}
              inputMode="decimal"
              suffix="kg"
              value={draft.weightKg}
              error={
                overWeight
                  ? `We carry parcels up to ${String(maxKg)} kg — split anything heavier`
                  : errors.weightKg
              }
              {...(maxKg !== null && !overWeight
                ? { hint: `Up to ${maxKg} kg. Over 5 kg is priced by the kilo.` }
                : {})}
              onChange={(e) => set('weightKg', e.target.value)}
            />
            <SelectField
              label="Size"
              value={draft.size}
              error={errors.size}
              onChange={(e) => set('size', e.target.value as ParcelSize)}
            >
              {parcelSizeSchema.options.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </SelectField>
          </div>
          <Field
            label="Description (optional)"
            placeholder="Documents"
            value={draft.description}
            error={errors.description}
            onChange={(e) => set('description', e.target.value)}
          />

          {/*
            The checkbox and nothing else. There used to be an "Amount to
            collect" field beside it, which was a customer setting what a rider
            must hand in — the server now takes that from the price snapshot,
            so there is no figure here to enter or to disagree with. The quote
            panel states the amount before the booking is confirmed.
          */}
          <label className="flex items-center gap-2 mb-15px text-body cursor-pointer">
            <input
              type="checkbox"
              checked={draft.isCod}
              onChange={(e) => set('isCod', e.target.checked)}
              className="w-4 h-4 accent-accent"
            />
            Collect cash on delivery
          </label>
        </Card>

        <div>
          {/* The one orange button on this screen (section 4). */}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={quote.isPending || overWeight}
          >
            {quote.isPending ? 'Checking addresses…' : 'Get price'}
          </Button>
          <p className="text-tiny text-faint mt-2">
            We look up both addresses to measure the route. This takes a moment.
          </p>
        </div>
      </form>

      {/* ---- quote panel ---- */}
      <div className="lg:sticky lg:top-[78px] grid gap-4">
        {problem ? (
          <Card title="Address problem">
            <p role="alert" className="text-sm text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2">
              {problem.message}
            </p>
            <p className="text-meta text-muted mt-3">
              {problem.field === 'pickup'
                ? 'Check the pick-up address.'
                : problem.field === 'drop'
                  ? 'Check the drop-off address.'
                  : 'Check both addresses.'}
              {problem.retryable ? ' You can try again in a moment.' : ''}
            </p>
          </Card>
        ) : null}

        {otherError ? (
          <Card title="Could not price this">
            <p role="alert" className="text-sm text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2">
              {otherError}
            </p>
          </Card>
        ) : null}

        {confirmed ? (
          <Card title="Price">
            <Eyebrow>Estimate</Eyebrow>
            <KeyValue k="Zone base">
              <span className="mono">{formatTaka(confirmed.price.zoneBase)}</span>
            </KeyValue>
            <KeyValue
              k={`Distance · ${formatKm(confirmed.price.distanceKm)} × ${confirmed.price.perKmRate}`}
            >
              <span className="mono">{formatTaka(confirmed.price.distanceCost)}</span>
            </KeyValue>
            <KeyValue k={confirmed.price.weightTierLabel}>
              <span className="mono">{formatTaka(confirmed.price.weightSurcharge)}</span>
            </KeyValue>
            <div className="flex justify-between items-baseline pt-4 mt-1 border-t border-border-strong">
              <span className="text-small font-semibold">Total</span>
              <span className="mono text-title font-medium">
                {formatTaka(confirmed.price.total)}
              </span>
            </div>

            <div className="mt-5 pt-4 border-t border-border grid gap-3">
              <div>
                <Eyebrow>Pick-up resolved to</Eyebrow>
                <p className="text-meta text-ink-2 leading-snug">
                  {confirmed.pickup.resolvedLabel}
                </p>
              </div>
              <div>
                <Eyebrow>Drop-off resolved to</Eyebrow>
                <p className="text-meta text-ink-2 leading-snug">
                  {confirmed.drop.resolvedLabel}
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="ink"
              size="lg"
              className="w-full mt-5"
              onClick={confirm}
              disabled={book.isPending || checkout.isPending}
            >
              {book.isPending
                ? 'Booking…'
                : checkout.isPending
                  ? 'Opening checkout…'
                  : draft.isCod
                    ? 'Confirm booking'
                    : 'Confirm and pay'}
            </Button>
            <p className="text-tiny text-faint mt-2">
              This price is fixed once booked, even if rates change later.
              {draft.isCod
                ? ` The rider collects ${formatTaka(confirmed.price.total)} in cash at the door.`
                : paymentConfig.data?.cardPayments
                  ? ' You will be taken to a secure checkout page.'
                  : ''}
            </p>
          </Card>
        ) : !problem && !otherError ? (
          <Card title="Price">
            {/* Empty state, not just the happy path. */}
            <p className="text-sm text-muted">
              Fill in both addresses and the weight, then choose{' '}
              <b className="font-semibold text-ink">Get price</b>.
            </p>
          </Card>
        ) : null}
      </div>
    </div>
  )
}
