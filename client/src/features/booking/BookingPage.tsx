import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  bookParcelInputSchema,
  heaviestPricedKg,
  parcelSizeSchema,
  type BookParcelInput,
  type ParcelSize,
  type RecentRecipient,
  type SavedAddress,
  type ZoneName,
} from '@pdms/shared'
import { Button } from '@/components/Button'
import { Field, SelectField } from '@/components/Field'
import { Card, Eyebrow, KeyValue } from '@/components/Card'
import { ApiError } from '@/lib/api'
import { formatKm, formatTaka } from '@/lib/format'
import { useAddSavedAddress, useMe, useSavedAddresses } from '../auth/useAuth'
import { usePaymentConfig, useStartCheckout } from '../payments/usePayments'
import { usePriceExample, usePricing, useZones } from '../pricing/usePricing'
import {
  asLookupProblem,
  useBookParcel,
  useQuote,
  useRecentRecipients,
  type BookResult,
  type QuoteResult,
} from './useBooking'

/**
 * Booking, in two steps: fill the form, then see a real quote before
 * committing. The quote step exists because geocoding and distance are real
 * lookups — the customer should see what they will be charged, and the
 * resolved addresses, before a parcel exists.
 *
 * M9.9 adds autofill on top of the same two steps, not a third: a saved
 * pick-up address or a recalled recipient just changes what the form
 * already contains when Get price is pressed. It does not change the flow.
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

/** The five fields a saved pick-up address (or clearing back to one) touches. */
const PICKUP_KEYS = new Set<keyof Draft>([
  'pickupLine1', 'pickupArea', 'pickupZone', 'senderName', 'senderPhone',
])

/** Draft (all strings, as the DOM gives them) -> the shared booking schema. */
const toPayload = (d: Draft, pickupSavedAddressId: string | null): unknown => ({
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
  ...(pickupSavedAddressId ? { pickupSavedAddressId } : {}),
})

type Errors = Record<string, string>

/**
 * Validated with the same schema the server uses (CLAUDE.md rule 4). The
 * server re-validates regardless — this only spares the customer a round trip.
 */
const validate = (
  d: Draft,
  pickupSavedAddressId: string | null,
): { ok: true; value: BookParcelInput } | { ok: false; errors: Errors } => {
  const parsed = bookParcelInputSchema.safeParse(toPayload(d, pickupSavedAddressId))
  if (parsed.success) return { ok: true, value: parsed.data }
  const errors: Errors = {}
  for (const issue of parsed.error.issues) errors[issue.path.join('.')] ??= issue.message
  return { ok: false, errors }
}

/** What a saved pick-up address is missing, in plain words — never silent. */
const missingFieldsNote = (a: SavedAddress): string | null => {
  const missing: string[] = []
  if (!a.zone) missing.push('zone')
  if (!a.contactPhone) missing.push('phone')
  if (missing.length === 0) return null
  return `This saved address has no ${missing.join(' or ')} on file — fill ${
    missing.length > 1 ? 'them' : 'it'
  } in below before continuing.`
}

/** The most recently used address, falling back to the first saved one. */
const mostRecentlyUsed = (list: readonly SavedAddress[]): SavedAddress | undefined =>
  list.reduce<SavedAddress | undefined>((best, a) => {
    if (!best) return a
    const at = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : -1
    const bt = best.lastUsedAt ? new Date(best.lastUsedAt).getTime() : -1
    return at > bt ? a : best
  }, undefined)

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

/** Same pill style ShiftEditor's mode toggle and rail chips already use. */
const chipClass = (active: boolean): string =>
  [
    'text-small font-medium px-4 min-h-10 rounded-pill border whitespace-nowrap',
    active
      ? 'bg-ink text-white border-transparent'
      : 'bg-surface text-ink-2 border-border-strong hover:bg-surface-sunk',
  ].join(' ')

export const BookingPage = () => {
  const navigate = useNavigate()
  const me = useMe()
  const zones = useZones()
  const pricing = usePricing()
  const paymentConfig = usePaymentConfig()
  const addresses = useSavedAddresses()
  const recipients = useRecentRecipients()
  const quote = useQuote()
  const book = useBookParcel()
  const checkout = useStartCheckout()
  const saveAddress = useAddSavedAddress()

  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [confirmed, setConfirmed] = useState<QuoteResult | null>(null)

  const [pickupSavedAddressId, setPickupSavedAddressId] = useState<string | null>(null)
  const [pickupEdited, setPickupEdited] = useState(false)
  const [pickupMissingNote, setPickupMissingNote] = useState<string | null>(null)
  const [postBookingOffer, setPostBookingOffer] = useState<{
    booked: BookResult
    line1: string
    area: string
  } | null>(null)

  const set = <K extends keyof Draft>(k: K, v: Draft[K]): void => {
    setDraft((d) => ({ ...d, [k]: v }))
    // A quote describes the addresses as they were; editing invalidates it.
    setConfirmed(null)
    if (PICKUP_KEYS.has(k)) setPickupEdited(true)
    if (k === 'pickupZone' || k === 'senderPhone') setPickupMissingNote(null)
  }

  /** Fills the pick-up + sender fields from one saved address. */
  const applyAddress = (a: SavedAddress, senderFallback: { name: string; phone: string }): void => {
    setDraft((d) => ({
      ...d,
      pickupLine1: a.line1,
      pickupArea: a.area,
      pickupZone: a.zone ?? '',
      senderName: a.contactName || senderFallback.name,
      senderPhone: a.contactPhone ?? senderFallback.phone,
    }))
    setConfirmed(null)
    setPickupSavedAddressId(a._id)
    setPickupEdited(false)
    setPickupMissingNote(missingFieldsNote(a))
  }

  const startNewPickup = (): void => {
    // Sender resets to the profile default too — a previously selected
    // address's own contact (a shop's staff, say) has no reason to survive
    // switching away from that address to a genuinely new one.
    setDraft((d) => ({
      ...d,
      pickupLine1: '',
      pickupArea: '',
      pickupZone: '',
      senderName: me.data?.name ?? '',
      senderPhone: me.data?.phone ?? '',
    }))
    setConfirmed(null)
    setPickupSavedAddressId(null)
    setPickupEdited(false)
    setPickupMissingNote(null)
  }

  const selectRecipient = (r: RecentRecipient): void => {
    setDraft((d) => ({
      ...d,
      recipientName: r.recipientName,
      recipientPhone: r.recipientPhone,
      dropLine1: r.dropLine1,
      dropArea: r.dropArea,
      dropZone: r.dropZone,
    }))
    setConfirmed(null)
  }

  /**
   * One-time defaults: sender from the logged-in account, pick-up from the
   * most recently used saved address (falling back to the first one). A
   * ref rather than re-checking draft state, so this never re-fires and
   * clobbers something the customer already typed or picked by hand.
   */
  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current) return
    if (me.isPending || addresses.isPending) return
    initialized.current = true

    const senderFallback = { name: me.data?.name ?? '', phone: me.data?.phone ?? '' }
    const list = addresses.data ?? []
    if (list.length === 0) {
      setDraft((d) => ({ ...d, senderName: senderFallback.name, senderPhone: senderFallback.phone }))
      return
    }
    const chosen = mostRecentlyUsed(list)
    if (chosen) applyAddress(chosen, senderFallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.isPending, me.data, addresses.isPending, addresses.data])

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

  /**
   * The progressive price panel's own real, partial computation — the SAME
   * pure formula a real quote uses (GET /pricing/example, open to any signed
   * -in role), pinned to `distanceKm: 0` since neither address is geocoded
   * yet. `zoneBase` and the weight tier are real numbers for THIS weight and
   * THIS zone the moment both are known; `distanceCost` and `total` from
   * this response are NOT real (a 0km distance costs nothing) and must never
   * be shown — see the panel below, which reads only the two safe fields.
   */
  const weightValid = Number.isFinite(enteredKg) && enteredKg > 0 && !overWeight
  const example = usePriceExample(
    weightValid && !confirmed
      ? { distanceKm: 0, weightKg: enteredKg, zone: draft.pickupZone || undefined }
      : null,
  )

  const requestQuote = (e: React.FormEvent): void => {
    e.preventDefault()
    const result = validate(draft, pickupSavedAddressId)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    quote.mutate(result.value, { onSuccess: (q) => setConfirmed(q) })
  }

  /** Whatever happens after a successful booking — COD lands on the parcel list, a card payment is redirected to checkout. */
  const proceedAfterBooking = (booked: BookResult): void => {
    const payOnline = !booked.parcel.isCod && paymentConfig.data?.cardPayments === true
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
   *
   * M9.9: a booking that used a saved pick-up address VERBATIM (selected and
   * never edited since) proceeds exactly as before. One typed by hand — or a
   * saved one since edited into something else — pauses here for one screen
   * offering to save it, before the SAME proceed step runs either way.
   */
  const confirm = (): void => {
    const result = validate(draft, pickupSavedAddressId)
    if (!result.ok) return

    book.mutate(result.value, {
      onSuccess: (booked) => {
        const usedSavedVerbatim = pickupSavedAddressId !== null && !pickupEdited
        if (usedSavedVerbatim) {
          proceedAfterBooking(booked)
          return
        }
        setPostBookingOffer({ booked, line1: draft.pickupLine1, area: draft.pickupArea })
      },
    })
  }

  const offerToSaveAddress = (): void => {
    if (!postBookingOffer) return
    saveAddress.mutate(
      {
        label: draft.pickupArea || 'Pick-up address',
        line1: draft.pickupLine1,
        area: draft.pickupArea,
        zone: draft.pickupZone as ZoneName,
        city: 'Dhaka',
        contactName: draft.senderName,
        contactPhone: draft.senderPhone,
      },
      { onSuccess: () => proceedAfterBooking(postBookingOffer.booked) },
    )
  }

  const problem = asLookupProblem(quote.error) ?? asLookupProblem(book.error)
  const otherError =
    !problem && (quote.error ?? book.error) instanceof ApiError
      ? ((quote.error ?? book.error) as ApiError).message
      : null

  const savedList = addresses.data ?? []
  const recentRecipients = recipients.data ?? []

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px] items-start">
      <form onSubmit={requestQuote} noValidate className="grid gap-5">
        {savedList.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {savedList.map((a) => (
              <button
                key={a._id}
                type="button"
                onClick={() => applyAddress(a, { name: me.data?.name ?? '', phone: me.data?.phone ?? '' })}
                className={chipClass(pickupSavedAddressId === a._id)}
              >
                {a.label}
              </button>
            ))}
            <button
              type="button"
              onClick={startNewPickup}
              className={chipClass(pickupSavedAddressId === null)}
            >
              + New address
            </button>
          </div>
        ) : null}

        <Card title="Pick-up">
          {pickupMissingNote ? (
            <p className="text-tiny text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mb-3">
              {pickupMissingNote}
            </p>
          ) : null}
          <div className="grid sm:grid-cols-3 gap-x-3">
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
          </div>
          <div className="grid sm:grid-cols-2 gap-x-3">
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
          </div>
        </Card>

        {recentRecipients.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {recentRecipients.map((r) => (
              <button
                key={`${r.recipientName}|${r.recipientPhone}|${r.dropLine1}`}
                type="button"
                onClick={() => selectRecipient(r)}
                className={chipClass(false)}
              >
                {r.recipientName} · {r.dropArea}
              </button>
            ))}
          </div>
        ) : null}

        <Card title="Drop-off">
          <div className="grid sm:grid-cols-3 gap-x-3">
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
          </div>
          <div className="grid sm:grid-cols-2 gap-x-3">
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
          </div>
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
        {postBookingOffer ? (
          <Card title="Booked">
            <p className="text-sm text-ink mb-3">
              Your parcel is booked. Save{' '}
              <b className="font-semibold">
                {postBookingOffer.line1}, {postBookingOffer.area}
              </b>{' '}
              as an address for next time?
            </p>
            <div className="flex gap-9px">
              <Button
                variant="primary"
                disabled={saveAddress.isPending}
                onClick={offerToSaveAddress}
              >
                {saveAddress.isPending ? 'Saving…' : 'Save address'}
              </Button>
              <Button
                type="button"
                disabled={saveAddress.isPending}
                onClick={() => proceedAfterBooking(postBookingOffer.booked)}
              >
                Not now
              </Button>
            </div>
          </Card>
        ) : (
          <>
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
                {/*
                  Progressive, not empty: whatever the panel already knows for
                  certain shows up as it becomes known. Distance and the real
                  total both need a geocoded route, which only Get price runs
                  — see usePriceExample's own note on why nothing here
                  fabricates them in the meantime.
                */}
                {example.data ? (
                  <div className="mb-4">
                    {draft.pickupZone ? (
                      <KeyValue k="Zone base">
                        <span className="mono">{formatTaka(example.data.zoneBase)}</span>
                      </KeyValue>
                    ) : null}
                    <KeyValue k={example.data.weightTierLabel}>
                      <span className="mono">{formatTaka(example.data.weightSurcharge)}</span>
                    </KeyValue>
                  </div>
                ) : null}
                <p className="text-sm text-muted">
                  {example.data ? (
                    <>
                      Distance and the total need both addresses — choose{' '}
                      <b className="font-semibold text-ink">Get price</b> when ready.
                    </>
                  ) : (
                    <>
                      Fill in both addresses and the weight, then choose{' '}
                      <b className="font-semibold text-ink">Get price</b>.
                    </>
                  )}
                </p>
              </Card>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
