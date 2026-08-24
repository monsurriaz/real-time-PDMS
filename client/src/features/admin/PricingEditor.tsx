import { useMemo, useState } from 'react'
import {
  pricingConfigInputSchema,
  type PricingConfigInput,
  type WeightTier,
  type ZoneName,
} from '@pdms/shared'
import { Button } from '@/components/Button'
import { Field, SelectField } from '@/components/Field'
import { Eyebrow, KeyValue, Note, Panel } from '@/components/Panel'
import { ApiError } from '@/lib/api'
import { formatKm, formatTaka } from '@/lib/format'
import {
  usePricePreview,
  usePricing,
  useSavePricing,
  useZones,
} from '../pricing/usePricing'

/**
 * The admin pricing screen (CLAUDE.md section 5: "Admins edit pricing from
 * the dashboard ... no deploy is needed to change a rate").
 *
 * Validation is the shared Zod schema, so the tier rules the admin sees are
 * the same ones the server enforces — and the server re-runs them regardless.
 */

/** Zod issue paths flattened to `field` -> message for inline display. */
type Errors = Record<string, string>

const collectErrors = (input: unknown): Errors => {
  const parsed = pricingConfigInputSchema.safeParse(input)
  if (parsed.success) return {}
  const out: Errors = {}
  for (const issue of parsed.error.issues) {
    const key = issue.path.join('.')
    // First message per path: later ones are usually consequences.
    out[key] ??= issue.message
  }
  return out
}

const EXAMPLE_DISTANCE_KM = 3
const EXAMPLE_WEIGHT_KG = 2

export const PricingEditor = () => {
  const stored = usePricing()
  const zones = useZones()
  const save = useSavePricing()

  const [draft, setDraft] = useState<PricingConfigInput | null>(null)
  const [exampleZone, setExampleZone] = useState<ZoneName | ''>('')
  const [saved, setSaved] = useState(false)

  // The draft starts as a copy of what is stored, once it arrives.
  const current: PricingConfigInput | null =
    draft ??
    (stored.data
      ? {
          perKmRate: stored.data.perKmRate,
          weightTiers: stored.data.weightTiers,
          zoneBaseOverrides: stored.data.zoneBaseOverrides,
        }
      : null)

  const errors = useMemo(
    () => (current ? collectErrors(current) : {}),
    [current],
  )
  const isValid = Object.keys(errors).length === 0

  const preview = usePricePreview(
    current && isValid
      ? {
          ...current,
          distanceKm: EXAMPLE_DISTANCE_KM,
          weightKg: EXAMPLE_WEIGHT_KG,
          ...(exampleZone ? { zone: exampleZone } : {}),
        }
      : null,
  )

  const edit = (next: PricingConfigInput): void => {
    setDraft(next)
    setSaved(false)
  }

  if (stored.isPending) {
    return <p className="text-muted text-[13.5px]">Loading pricing…</p>
  }
  if (stored.isError || !current) {
    return (
      <p className="text-[13.5px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2">
        {stored.error instanceof ApiError
          ? stored.error.message
          : 'Pricing could not be loaded.'}
      </p>
    )
  }

  const setTier = (i: number, patch: Partial<WeightTier>): void => {
    edit({
      ...current,
      weightTiers: current.weightTiers.map((t, idx) =>
        idx === i ? { ...t, ...patch } : t,
      ),
    })
  }

  const addTier = (): void => {
    const last = current.weightTiers.at(-1)
    edit({
      ...current,
      weightTiers: [
        ...current.weightTiers,
        {
          // Pre-fill above the current top bound so the new row starts valid.
          maxKg: last ? last.maxKg + 2 : 1,
          baseFee: last ? last.baseFee + 40 : 60,
          label: last ? `${last.maxKg} - ${last.maxKg + 2} kg` : 'Up to 1 kg',
        },
      ],
    })
  }

  const removeTier = (i: number): void => {
    edit({
      ...current,
      weightTiers: current.weightTiers.filter((_, idx) => idx !== i),
    })
  }

  const setOverride = (zone: ZoneName, raw: string): void => {
    const trimmed = raw.trim()
    const rest = current.zoneBaseOverrides.filter((o) => o.zone !== zone)
    // Empty means "no override" — fall back to the zone's own baseFare.
    edit({
      ...current,
      zoneBaseOverrides:
        trimmed === ''
          ? rest
          : [...rest, { zone, baseFare: Math.max(0, Number(trimmed) || 0) }],
    })
  }

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!isValid) return
    save.mutate(current, {
      onSuccess: () => {
        setDraft(null)
        setSaved(true)
      },
    })
  }

  const saveError = save.error instanceof ApiError ? save.error.message : null
  const dirty = draft !== null

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px] items-start">
        <div className="grid gap-5">
          <Panel title="Distance rate">
            <Field
              label="Per kilometre"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={String(current.perKmRate)}
              suffix="৳ / km"
              error={errors.perKmRate}
              hint="Applied to the road distance from OpenRouteService."
              onChange={(e) =>
                edit({ ...current, perKmRate: Number(e.target.value) })
              }
            />
          </Panel>

          <Panel
            title="Weight tiers"
            action={
              <Button type="button" onClick={addTier}>
                Add tier
              </Button>
            }
          >
            <p className="text-[12.5px] text-muted mb-4">
              Bounds are inclusive and must ascend without overlapping. A
              parcel is charged the first tier its weight fits.
            </p>

            {/* Header row, mirroring the reference's table caps. */}
            <div className="hidden sm:grid grid-cols-[1fr_1fr_1.4fr_auto] gap-3 mb-2">
              {['Up to (kg)', 'Fee (৳)', 'Label', ''].map((h) => (
                <span
                  key={h}
                  className="text-[11px] font-semibold uppercase tracking-[0.13em] text-faint"
                >
                  {h}
                </span>
              ))}
            </div>

            {current.weightTiers.map((tier, i) => (
              <div
                key={i}
                className="grid sm:grid-cols-[1fr_1fr_1.4fr_auto] gap-3 items-start border-b border-hairline last:border-b-0 py-3 first:pt-0"
              >
                <Field
                  label="Up to (kg)"
                  type="number"
                  min={0}
                  step={0.5}
                  value={String(tier.maxKg)}
                  error={errors[`weightTiers.${i}.maxKg`]}
                  onChange={(e) => setTier(i, { maxKg: Number(e.target.value) })}
                />
                <Field
                  label="Fee (৳)"
                  type="number"
                  min={0}
                  step={1}
                  value={String(tier.baseFee)}
                  error={errors[`weightTiers.${i}.baseFee`]}
                  onChange={(e) => setTier(i, { baseFee: Number(e.target.value) })}
                />
                <Field
                  label="Label"
                  value={tier.label}
                  error={errors[`weightTiers.${i}.label`]}
                  onChange={(e) => setTier(i, { label: e.target.value })}
                />
                <div className="sm:pt-[26px]">
                  <Button
                    type="button"
                    onClick={() => removeTier(i)}
                    disabled={current.weightTiers.length === 1}
                    aria-label={`Remove tier ${tier.label}`}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}

            {errors.weightTiers ? (
              <p role="alert" className="text-[12.5px] text-failed-ink mt-3">
                {errors.weightTiers}
              </p>
            ) : null}
          </Panel>

          <Panel title="Per-zone base fare">
            <p className="text-[12.5px] text-muted mb-4">
              Optional. Leave blank to use the zone&apos;s own base fare.
            </p>
            {zones.isPending ? (
              <p className="text-[13px] text-muted">Loading zones…</p>
            ) : zones.data && zones.data.length > 0 ? (
              <div className="grid sm:grid-cols-2 gap-x-5">
                {zones.data.map((z) => {
                  const override = current.zoneBaseOverrides.find(
                    (o) => o.zone === z.name,
                  )
                  return (
                    <Field
                      key={z.name}
                      label={z.name}
                      type="number"
                      min={0}
                      step={1}
                      placeholder={String(z.baseFare)}
                      suffix="৳"
                      value={override ? String(override.baseFare) : ''}
                      hint={
                        override
                          ? 'Override in effect'
                          : `Zone default ${formatTaka(z.baseFare)}`
                      }
                      onChange={(e) => setOverride(z.name, e.target.value)}
                    />
                  )
                })}
              </div>
            ) : (
              <p className="text-[13px] text-muted">
                No serviceable zones — run the seed script.
              </p>
            )}
          </Panel>
        </div>

        {/* ---- live worked example ---- */}
        <div className="lg:sticky lg:top-[78px] grid gap-4">
          <Panel title="Worked example">
            <Eyebrow>
              {formatKm(EXAMPLE_DISTANCE_KM)} · {EXAMPLE_WEIGHT_KG} kg
            </Eyebrow>

            <SelectField
              label="Zone"
              value={exampleZone}
              onChange={(e) => setExampleZone(e.target.value as ZoneName | '')}
            >
              <option value="">No zone base</option>
              {(zones.data ?? []).map((z) => (
                <option key={z.name} value={z.name}>
                  {z.name}
                </option>
              ))}
            </SelectField>

            {!isValid ? (
              <p className="text-[12.5px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2">
                Fix the errors above to see the price.
              </p>
            ) : preview.isPending ? (
              <p className="text-[13px] text-muted">Calculating…</p>
            ) : preview.isError ? (
              <p className="text-[12.5px] text-failed-ink">
                {preview.error instanceof ApiError
                  ? preview.error.message
                  : 'Could not calculate.'}
              </p>
            ) : preview.data ? (
              <>
                <KeyValue k="Zone base">
                  <span className="mono">{formatTaka(preview.data.zoneBase)}</span>
                </KeyValue>
                <KeyValue
                  k={`Distance · ${formatKm(preview.data.distanceKm)} × ${preview.data.perKmRate}`}
                >
                  <span className="mono">
                    {formatTaka(preview.data.distanceCost)}
                  </span>
                </KeyValue>
                <KeyValue k={preview.data.weightTierLabel}>
                  <span className="mono">
                    {formatTaka(preview.data.weightSurcharge)}
                  </span>
                </KeyValue>
                <div className="flex justify-between items-baseline pt-4 mt-1 border-t border-hairline-strong">
                  <span className="text-[12.5px] font-semibold">Total</span>
                  <span className="mono text-[19px] font-medium">
                    {formatTaka(preview.data.total)}
                  </span>
                </div>
              </>
            ) : null}
          </Panel>

          <Panel>
            {saveError ? (
              <p
                role="alert"
                className="text-[12.5px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mb-3"
              >
                {saveError}
              </p>
            ) : null}
            {saved && !dirty ? (
              <p className="text-[12.5px] text-delivered-ink bg-delivered-bg rounded-sm px-3 py-2 mb-3">
                Saved. New bookings use these rates immediately.
              </p>
            ) : null}

            {/* Admin actions use ink, not the orange (section 4). */}
            <Button
              type="submit"
              variant="ink"
              size="lg"
              className="w-full"
              disabled={!isValid || !dirty || save.isPending}
            >
              {save.isPending ? 'Saving…' : dirty ? 'Save pricing' : 'No changes'}
            </Button>

            {dirty ? (
              <Button
                type="button"
                className="w-full mt-2"
                onClick={() => {
                  setDraft(null)
                  setSaved(false)
                }}
              >
                Discard changes
              </Button>
            ) : null}
          </Panel>

          <Note>
            Prices are <b>snapshotted at booking</b>. Changing a rate here
            never alters a parcel that has already been booked.
          </Note>
        </div>
      </div>
    </form>
  )
}
