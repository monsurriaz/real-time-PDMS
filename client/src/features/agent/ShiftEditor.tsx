import { useState } from 'react'
import { setAgentLocationInputSchema, type ZoneName } from '@pdms/shared'
import { Button } from '@/components/Button'
import { Field, SelectField } from '@/components/Field'
import { Eyebrow } from '@/components/Card'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { useZones } from '../pricing/usePricing'
import { useLocationWatcherState } from './locationWatcherStore'
import { useAgentSelf, useSetAgentStatus, useSetLocation } from './useAgentSelf'

/**
 * The rider's shift controls: where they are, and whether they are on duty —
 * the same form the old build gave a whole Card at the top of the run list.
 *
 * v3's Shell section folds "shift" into the rail, so this is now the CONTENT
 * of that rail's popover (see ShiftRail) rather than a page in its own right.
 * It has no Card wrapper of its own for that reason — the caller supplies the
 * surface, sizing and dismissal.
 *
 * Both fields feed the $near assignment query in CLAUDE.md section 5 —
 * without a way to move a rider, proximity assignment cannot be exercised.
 *
 * M9.7: location-setting is three tiers, in priority order, replacing the
 * raw zone-or-lat/lng form M3.5 built as a stand-in before there was a UI in
 * front of it — no real rider knows their own coordinates.
 *   1. "Use my current location" — the browser's GPS, one tap, PLUS an idle
 *      background watcher (useIdleLocationWatcher, mounted once in ShiftRail
 *      rather than here — see that hook's own note on why).
 *   2. Type an address — geocoded through the exact same Nominatim wrapper
 *      booking uses (server's geocodeAddress), same cache, same failure
 *      shape (asLookupProblem-compatible: reads off ApiError, not repeated
 *      here since this form just shows the message).
 *   3. Pick a zone — demoted below the other two, kept because it is the
 *      only tier that works with GPS denied and no resolvable address, and
 *      it drops a rider into a zone instantly for rehearsal.
 * Raw coordinates still exist, behind an "Advanced" disclosure, for the same
 * rehearsal reason — never as something a rider is expected to reach for.
 */

const STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  on_delivery: 'On a delivery',
  offline: 'Off shift',
}

type LocationMode = 'address' | 'zone'

export const ShiftEditor = ({ onLocationSaved }: { onLocationSaved?: () => void }) => {
  const me = useAgentSelf()
  const zones = useZones()
  const setLocation = useSetLocation()
  const setStatus = useSetAgentStatus()
  const watcher = useLocationWatcherState()

  const [mode, setMode] = useState<LocationMode>('address')
  const [line1, setLine1] = useState('')
  const [area, setArea] = useState('')
  const [addrZone, setAddrZone] = useState<ZoneName | ''>('')
  const [zone, setZone] = useState<ZoneName | ''>('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [invalid, setInvalid] = useState<string | null>(null)
  const [advancedInvalid, setAdvancedInvalid] = useState<string | null>(null)
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)

  if (me.isPending) {
    return <p className="text-sm text-muted">Loading…</p>
  }
  if (me.isError || !me.data) {
    return (
      <p role="alert" className="text-sm text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2">
        {me.error instanceof ApiError ? me.error.message : 'Could not load your rider record.'}
      </p>
    )
  }

  const agent = me.data
  const midDelivery = agent.status === 'on_delivery'
  const statusError = setStatus.error instanceof ApiError ? setStatus.error.message : null
  const locationError = setLocation.error instanceof ApiError ? setLocation.error.message : null

  /** Tier 1, one tap: the browser's own GPS. Falls through to tier 2 on denial. */
  const useMyLocation = (): void => {
    setGeoError(null)
    setInvalid(null)
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError('This browser cannot report your location — type an address or pick a zone below.')
      setMode('address')
      return
    }
    setGeoBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoBusy(false)
        setLocation.mutate(
          { mode: 'coords', lat: pos.coords.latitude, lng: pos.coords.longitude },
          { onSuccess: () => onLocationSaved?.() },
        )
      },
      (err) => {
        setGeoBusy(false)
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Location access denied — type an address or pick a zone below.'
            : 'Could not get your location — type an address or pick a zone below.',
        )
        setMode('address')
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000 },
    )
  }

  /** Tiers 2 and 3: address or zone, whichever tab is open. */
  const submitLocation = (e: React.FormEvent): void => {
    e.preventDefault()
    setInvalid(null)
    const payload =
      mode === 'zone'
        ? { mode: 'zone' as const, zone }
        : { mode: 'address' as const, address: { line1, area, zone: addrZone, city: 'Dhaka' } }

    // Same schema the server uses (rule 4); the server re-validates anyway.
    const parsed = setAgentLocationInputSchema.safeParse(payload)
    if (!parsed.success) {
      setInvalid(parsed.error.issues[0]?.message ?? 'check the location')
      return
    }
    setLocation.mutate(parsed.data, { onSuccess: () => onLocationSaved?.() })
  }

  /** The advanced disclosure: raw coordinates, for rehearsal — never the primary path. */
  const submitCoords = (e: React.FormEvent): void => {
    e.preventDefault()
    setAdvancedInvalid(null)
    const parsed = setAgentLocationInputSchema.safeParse({
      mode: 'coords',
      lat: Number(lat),
      lng: Number(lng),
    })
    if (!parsed.success) {
      setAdvancedInvalid(parsed.error.issues[0]?.message ?? 'check the coordinates')
      return
    }
    setLocation.mutate(parsed.data, { onSuccess: () => onLocationSaved?.() })
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <Eyebrow tone="strong">Status</Eyebrow>
          <p className="text-md font-semibold">
            {STATUS_LABEL[agent.status] ?? agent.status}
          </p>
          <p className="text-tiny text-muted mt-0.5">
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
        <p className="text-meta text-muted mb-4">
          You are carrying a parcel. Finish it, or ask an admin to reassign it,
          before changing your shift.
        </p>
      ) : agent.status === 'offline' ? (
        <p className="text-meta text-muted mb-4">
          Off shift — you will not be offered new work until you go available.
        </p>
      ) : null}

      {statusError ? (
        <p role="alert" className="text-small text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mb-4">
          {statusError}
        </p>
      ) : null}

      <div className="border-t border-border pt-4">
        <Eyebrow tone="strong">Your location</Eyebrow>

        {agent.currentLocation ? (
          <div className="mb-3">
            <p className="text-md font-semibold text-ink">
              {agent.locationLabel ??
                `${agent.currentLocation.coordinates[1].toFixed(4)}, ${agent.currentLocation.coordinates[0].toFixed(4)}`}
            </p>
            {agent.locationLabel ? (
              <p className="mono text-tiny text-muted">
                {agent.currentLocation.coordinates[1].toFixed(4)}, {agent.currentLocation.coordinates[0].toFixed(4)}
              </p>
            ) : null}
            <p className="text-eyebrow text-muted mt-0.5">
              {agent.locationUpdatedAt ? `set ${formatDateTime(agent.locationUpdatedAt)}` : null}
              {watcher.isWatching ? ' · updating automatically' : null}
            </p>
          </div>
        ) : (
          <p className="text-small text-muted mb-3">
            Not set — proximity assignment will skip you until it is.
          </p>
        )}

        {watcher.permissionDenied ? (
          <p className="text-small text-muted mb-3">
            Automatic location is off — location access was denied. Set it
            manually below.
          </p>
        ) : null}

        <Button
          type="button"
          variant="primary"
          size="lg"
          className="w-full mb-3"
          disabled={geoBusy}
          onClick={useMyLocation}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          {geoBusy ? 'Getting your location…' : 'Use my current location'}
        </Button>

        {geoError ? (
          <p role="alert" className="text-small text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mb-3">
            {geoError}
          </p>
        ) : null}

        {/* GPS is the one-tap path above; everything below is the fallback. */}
        <div className="flex items-center gap-10px my-4">
          <hr className="flex-1 border-t border-border" />
          <Eyebrow>or set manually</Eyebrow>
          <hr className="flex-1 border-t border-border" />
        </div>

        <form onSubmit={submitLocation} noValidate>
          <div
            className="flex gap-3px p-3px bg-surface-sunk rounded-pill mb-3"
            role="radiogroup"
            aria-label="How to set your location"
          >
            {(['address', 'zone'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={[
                  // 48px floor, same as every other control a rider taps.
                  'flex-1 text-small font-semibold min-h-12 rounded-pill transition-colors duration-100',
                  mode === m ? 'bg-surface text-ink' : 'text-muted',
                ].join(' ')}
              >
                {m === 'address' ? 'Type an address' : 'Pick a zone'}
              </button>
            ))}
          </div>

          {mode === 'address' ? (
            <>
              <Field
                touch
                label="Street, house, road"
                placeholder="House 12, Road 3"
                value={line1}
                onChange={(e) => setLine1(e.target.value)}
              />
              <Field
                touch
                label="Area"
                placeholder="Dhanmondi 27"
                value={area}
                onChange={(e) => setArea(e.target.value)}
              />
              <SelectField
                touch
                label="Zone"
                value={addrZone}
                onChange={(e) => setAddrZone(e.target.value as ZoneName | '')}
              >
                <option value="">Select a zone</option>
                {(zones.data ?? []).map((z) => (
                  <option key={z.name} value={z.name}>
                    {z.label}
                  </option>
                ))}
              </SelectField>
            </>
          ) : (
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
          )}

          {(invalid ?? locationError) ? (
            <p role="alert" className="text-small text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mb-3">
              {invalid ?? locationError}
            </p>
          ) : null}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={setLocation.isPending}
          >
            {setLocation.isPending
              ? 'Saving…'
              : mode === 'address'
                ? 'Set from this address'
                : 'Set to zone centre'}
          </Button>
        </form>

        <details className="mt-4">
          <summary className="text-tiny text-muted cursor-pointer select-none">
            Advanced: enter coordinates directly
          </summary>
          <form onSubmit={submitCoords} noValidate className="mt-3">
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
            {advancedInvalid ? (
              <p role="alert" className="text-small text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mb-3">
                {advancedInvalid}
              </p>
            ) : null}
            <Button type="submit" size="lg" className="w-full" disabled={setLocation.isPending}>
              {setLocation.isPending ? 'Saving…' : 'Set from coordinates'}
            </Button>
          </form>
        </details>
      </div>
    </div>
  )
}
