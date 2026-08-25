import { useState } from 'react'
import { updateAgentDetailsInputSchema, vehicleSchema, type AgentSelf, type ZoneName } from '@pdms/shared'
import { Button } from '@/components/Button'
import { SelectField } from '@/components/Field'
import { ApiError } from '@/lib/api'
import { ProfileBlockHeading } from '../profile/ProfileShell'
import { useZones } from '../pricing/usePricing'
import { ShiftEditor } from './ShiftEditor'
import { useUpdateAgentDetails } from './useAgentSelf'

const VEHICLE_LABEL: Record<string, string> = {
  motorcycle: 'Motorcycle',
  bicycle: 'Bicycle',
  van: 'Van',
}

/**
 * The agent profile's role-specific tab. Vehicle and covered zones are new
 * here — v3's signup only collects one "preferred zone", so this is where a
 * rider can add coverage later. Shift status and location are NOT
 * reimplemented here: this absorbs the same ShiftEditor the rail's popover
 * already uses (M6.5b), so there is exactly one place that logic lives.
 *
 * Zones stays a single-select, matching signup's own "one preferred zone"
 * simplicity rather than introducing a multi-select control nothing else in
 * this build needs.
 */
export const RiderDetailsTab = ({ agent }: { agent: AgentSelf }) => {
  const update = useUpdateAgentDetails()
  const zones = useZones()
  const [vehicle, setVehicle] = useState(agent.vehicle)
  const [zone, setZone] = useState<ZoneName | ''>(agent.zones[0] ?? '')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  const dirty = vehicle !== agent.vehicle || zone !== (agent.zones[0] ?? '')

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    setFieldError(null)
    setJustSaved(false)
    const parsed = updateAgentDetailsInputSchema.safeParse({
      vehicle,
      zones: zone ? [zone] : [],
    })
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'check your details')
      return
    }
    update.mutate(parsed.data, { onSuccess: () => setJustSaved(true) })
  }

  const serverError = update.error instanceof ApiError ? update.error.message : null

  return (
    <div>
      <form onSubmit={submit} noValidate>
        <ProfileBlockHeading>Rider details</ProfileBlockHeading>
        <div className="grid grid-cols-2 gap-x-3">
          <SelectField
            label="Vehicle"
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value as typeof vehicle)}
          >
            {vehicleSchema.options.map((v) => (
              <option key={v} value={v}>
                {VEHICLE_LABEL[v] ?? v}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Zone covered"
            value={zone}
            onChange={(e) => setZone(e.target.value as ZoneName | '')}
          >
            <option value="">Select a zone</option>
            {(zones.data ?? []).map((z) => (
              <option key={z.name} value={z.name}>
                {z.label}
              </option>
            ))}
          </SelectField>
        </div>

        <p className="text-small text-muted mb-4">
          NID / licence <span className="mono text-ink-2">{agent.nid}</span> — not
          editable once submitted.
        </p>

        {(fieldError ?? serverError) ? (
          <p role="alert" className="text-small text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mb-3">
            {fieldError ?? serverError}
          </p>
        ) : justSaved && !dirty ? (
          <p className="text-small text-delivered-ink mb-3">Saved.</p>
        ) : null}

        <Button type="submit" variant="primary" disabled={update.isPending || !dirty}>
          {update.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </form>

      <div className="mt-6 pt-5 border-t border-border">
        <ProfileBlockHeading>Shift &amp; location</ProfileBlockHeading>
        <ShiftEditor />
      </div>
    </div>
  )
}
