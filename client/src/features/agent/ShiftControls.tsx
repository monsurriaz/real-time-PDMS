import { useState } from 'react'
import { setAgentLocationInputSchema, type ZoneName } from '@pdms/shared'
import { Button } from '@/components/Button'
import { Field, SelectField } from '@/components/Field'
import { Eyebrow, Panel } from '@/components/Panel'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { useZones } from '../pricing/usePricing'
import { useAgentSelf, useSetAgentStatus, useSetLocation } from './useAgentSelf'

/**
 * The rider's shift controls: where they are, and whether they are on duty.
 *
 * This stands in for the GPS stream until M4 (CLAUDE.md section 6). Both
 * fields feed the $near assignment query in section 5 — without a way to move
 * a rider by hand, proximity assignment cannot be exercised at all.
 */

const STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  on_delivery: 'On a delivery',
  offline: 'Off shift',
}

export const ShiftControls = () => {
  const me = useAgentSelf()
  const zones = useZones()
  const setLocation = useSetLocation()
  const setStatus = useSetAgentStatus()

  const [mode, setMode] = useState<'zone' | 'coords'>('zone')
  const [zone, setZone] = useState<ZoneName | ''>('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [invalid, setInvalid] = useState<string | null>(null)

  if (me.isPending) {
    return (
      <Panel title="Your shift" className="mb-5">
        <p className="text-[13px] text-muted">Loading…</p>
      </Panel>
    )
  }
  if (me.isError || !me.data) {
    return (
      <Panel title="Your shift" className="mb-5">
        <p role="alert" className="text-[13px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2">
          {me.error instanceof ApiError
            ? me.error.message
            : 'Could not load your rider record.'}
        </p>
      </Panel>
    )
  }

  const agent = me.data
  const midDelivery = agent.status === 'on_delivery'
  const statusError = setStatus.error instanceof ApiError ? setStatus.error.message : null
  const locationError = setLocation.error instanceof ApiError ? setLocation.error.message : null

  const submitLocation = (e: React.FormEvent): void => {
    e.preventDefault()
    setInvalid(null)
    const payload =
      mode === 'zone'
        ? { mode: 'zone' as const, zone }
        : { mode: 'coords' as const, lat: Number(lat), lng: Number(lng) }

    // Same schema the server uses (rule 4); the server re-validates anyway.
    const parsed = setAgentLocationInputSchema.safeParse(payload)
    if (!parsed.success) {
      setInvalid(parsed.error.issues[0]?.message ?? 'check the location')
      return
    }
    setLocation.mutate(parsed.data)
  }

  return (
    <Panel title="Your shift" className="mb-5">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <Eyebrow tone="strong">Status</Eyebrow>
          <p className="text-[15px] font-semibold">
            {STATUS_LABEL[agent.status] ?? agent.status}
          </p>
          <p className="text-[11.5px] text-muted mt-0.5">
            {agent.activeCount} active{' '}
            {agent.activeCount === 1 ? 'delivery' : 'deliveries'}
          </p>
        </div>
        <Button
          variant="ink"
          size="lg"
          disabled={midDelivery || setStatus.isPending}
          onClick={() =>
            setStatus.mutate({
              status: agent.status === 'available' ? 'offline' : 'available',
            })
          }
        >
          {setStatus.isPending
            ? 'Saving…'
            : agent.status === 'available'
              ? 'Go off shift'
              : 'Go available'}
        </Button>
      </div>

      {midDelivery ? (
        <p className="text-[12px] text-muted mb-4">
          You are carrying a parcel. Finish it, or ask an admin to reassign it,
          before changing your shift.
        </p>
      ) : agent.status === 'offline' ? (
        <p className="text-[12px] text-muted mb-4">
          Off shift — you will not be offered new work until you go available.
        </p>
      ) : null}

      {statusError ? (
        <p role="alert" className="text-[12.5px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mb-4">
          {statusError}
        </p>
      ) : null}

      <div className="border-t border-hairline pt-4">
        <Eyebrow tone="strong">Your location</Eyebrow>
        {agent.currentLocation ? (
          <p className="mono text-[12.5px] mb-3">
            {agent.currentLocation.coordinates[1].toFixed(4)},{' '}
            {agent.currentLocation.coordinates[0].toFixed(4)}
            {agent.locationUpdatedAt ? (
              <span className="block font-sans text-[11px] text-muted">
                set {formatDateTime(agent.locationUpdatedAt)}
              </span>
            ) : null}
          </p>
        ) : (
          <p className="text-[12.5px] text-muted mb-3">
            Not set — proximity assignment will skip you until it is.
          </p>
        )}

        <form onSubmit={submitLocation} noValidate>
          <div className="flex gap-2 mb-3">
            {(['zone', 'coords'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={[
                  // 48px floor, same as every other control a rider taps.
                  'text-[12.5px] font-medium px-4 min-h-12 rounded-pill border',
                  mode === m
                    ? 'bg-ink text-white border-transparent'
                    : 'bg-surface text-ink-2 border-hairline-strong hover:bg-surface-sunk',
                ].join(' ')}
              >
                {m === 'zone' ? 'Pick a zone' : 'Coordinates'}
              </button>
            ))}
          </div>

          {mode === 'zone' ? (
            <SelectField
              touch
              label="Zone centre"
              value={zone}
              hint="Drops you at the centre of that zone."
              onChange={(e) => setZone(e.target.value as ZoneName | '')}
            >
              <option value="">Select a zone</option>
              {(zones.data ?? []).map((z) => (
                <option key={z.name} value={z.name}>
                  {z.label}
                </option>
              ))}
            </SelectField>
          ) : (
            <div className="grid grid-cols-2 gap-x-3">
              <Field
              touch
                label="Latitude"
                inputMode="decimal"
                placeholder="23.7461"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
              />
              <Field
              touch
                label="Longitude"
                inputMode="decimal"
                placeholder="90.3742"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
              />
            </div>
          )}

          {(invalid ?? locationError) ? (
            <p role="alert" className="text-[12.5px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mb-3">
              {invalid ?? locationError}
            </p>
          ) : null}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={setLocation.isPending}
          >
            {setLocation.isPending ? 'Saving…' : 'Set my location'}
          </Button>
        </form>
      </div>
    </Panel>
  )
}
