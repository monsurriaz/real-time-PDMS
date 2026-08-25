import { useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { registerInputSchema, vehicleSchema, zoneName, type ZoneName } from '@pdms/shared'
import { Button } from '@/components/Button'
import { Field, SelectField } from '@/components/Field'
import { ApiError } from '@/lib/api'
import { AuthSplit } from './AuthSplit'
import { homeForRole } from './roles'
import { useMe, useRegister } from './useAuth'

/**
 * v3's Auth section: role first, because it changes the fields and a rider
 * needs to know approval is involved before typing anything else.
 *
 * Validated with registerInputSchema — the same discriminated union the
 * server parses — so "what does the agent branch require" cannot drift
 * between this form and POST /auth/register (CLAUDE.md rule 4).
 */

const VEHICLE_LABEL: Record<string, string> = {
  motorcycle: 'Motorcycle',
  bicycle: 'Bicycle',
  van: 'Van',
}

export const SignupPage = () => {
  const me = useMe()
  const register = useRegister()
  const [params] = useSearchParams()

  const [role, setRole] = useState<'customer' | 'agent'>(
    params.get('role') === 'agent' ? 'agent' : 'customer',
  )
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [zone, setZone] = useState<ZoneName | ''>('')
  const [vehicle, setVehicle] = useState<(typeof vehicleSchema.options)[number]>('motorcycle')
  const [nid, setNid] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)

  // Already signed in — send them to their own landing page, same as login.
  if (me.data) return <Navigate to={homeForRole(me.data.role)} replace />

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    setFieldError(null)

    const payload =
      role === 'customer'
        ? { role: 'customer' as const, name, email, phone, password, ...(zone ? { zone } : {}) }
        : { role: 'agent' as const, name, email, phone, password, vehicle, zone: zone as ZoneName, nid }

    const parsed = registerInputSchema.safeParse(payload)
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'check your details')
      return
    }
    register.mutate(parsed.data)
  }

  // A fresh registration always lands here — an agent is pending by
  // construction, and there is nowhere else a brand-new one could be.
  if (register.isSuccess) {
    return (
      <Navigate
        to={register.data.user.role === 'agent' ? '/agent/pending' : homeForRole('customer')}
        replace
      />
    )
  }

  const serverError = register.error instanceof ApiError ? register.error.message : null

  return (
    /**
     * The identical shell login uses — one layout component, two forms, per
     * the v3.1 addendum's own note ("not two page designs").
     */
    <AuthSplit
      pageClass="signup"
      heading="Dhaka's parcels, tracked to the door."
      body="Six zones, live rider positions, and proof of delivery on every handover."
    >
      <h1 className="text-h2 font-semibold tracking-[-0.03em]">Create an account</h1>

      <form onSubmit={submit} noValidate className="mt-22px">
        <div className="grid grid-cols-2 gap-9px mb-14px" role="radiogroup" aria-label="Account type">
          {(
            [
              { value: 'customer', title: 'I send parcels', detail: 'Book and track' },
              { value: 'agent', title: 'I deliver parcels', detail: 'Apply as a rider' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={role === opt.value}
              onClick={() => setRole(opt.value)}
              className={[
                'text-left rounded-md border px-4 py-3 cursor-pointer',
                role === opt.value
                  ? 'border-accent bg-accent-tint'
                  : 'border-border-strong hover:bg-surface-sunk',
              ].join(' ')}
            >
              <div className="text-sm font-semibold">{opt.title}</div>
              <div className="text-tiny text-muted">{opt.detail}</div>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <Field
            label="Phone"
            type="tel"
            placeholder="01XXXXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />

        {role === 'agent' ? (
          <>
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
                label="Preferred zone"
                value={zone}
                onChange={(e) => setZone(e.target.value as ZoneName | '')}
              >
                <option value="">Select a zone</option>
                {zoneName.options.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </SelectField>
            </div>
            <Field
              label="NID or licence number"
              value={nid}
              onChange={(e) => setNid(e.target.value)}
            />
          </>
        ) : (
          <SelectField
            label="Home zone (optional)"
            value={zone}
            onChange={(e) => setZone(e.target.value as ZoneName | '')}
            hint="Defaults your pickup area when you book."
          >
            <option value="">Select a zone</option>
            {zoneName.options.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </SelectField>
        )}

        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {role === 'agent' ? (
          <div className="bg-pending-bg text-pending-ink rounded-md px-14px py-3 mb-4 text-small">
            Rider accounts are reviewed before activation. You can sign in
            right away, but jobs only start arriving once an admin
            approves you.
          </div>
        ) : null}

        {(fieldError ?? serverError) ? (
          <p role="alert" className="text-small text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mb-3">
            {fieldError ?? serverError}
          </p>
        ) : null}

        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={register.isPending}>
          {register.isPending
            ? 'Creating account…'
            : role === 'agent'
              ? 'Submit application'
              : 'Create account'}
        </Button>
      </form>

      <p className="text-body text-muted text-center mt-4">
        Already have an account?{' '}
        <Link to="/login" className="text-accent-hover font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </AuthSplit>
  )
}
