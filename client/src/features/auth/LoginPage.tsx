import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { loginInputSchema } from '@pdms/shared'
import { Button } from '@/components/Button'
import { Field } from '@/components/Field'
import { ApiError } from '@/lib/api'
import { AuthSplit } from './AuthSplit'
import { homeForRole } from './roles'
import { useLogin, useMe } from './useAuth'

/** Every seeded account shares one password (scripts/seed.ts). */
const DEMO_PASSWORD = 'pdms-demo-2026'

/**
 * Gated behind an env flag so an examiner isn't hunting for credentials —
 * shown by default (this IS the course demo), off only when a real deploy
 * explicitly sets VITE_SHOW_DEMO_LOGINS=false.
 */
const SHOW_DEMO_LOGINS = import.meta.env?.VITE_SHOW_DEMO_LOGINS !== 'false'

/**
 * Sign in. Validates with the same Zod schema the server uses, so the client's
 * rules cannot drift from the server's — and the server still re-validates,
 * because it must (definition of done).
 */
export const LoginPage = () => {
  const me = useMe()
  const login = useLogin()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)

  // Already signed in — send them to their own landing page.
  if (me.data) return <Navigate to={homeForRole(me.data.role)} replace />

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    setFieldError(null)

    const parsed = loginInputSchema.safeParse({ email, password })
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'check your details')
      return
    }
    login.mutate(parsed.data)
  }

  const serverError =
    login.error instanceof ApiError ? login.error.message : null

  return (
    /**
     * v3.1's auth split: a chrome-dark proposition panel beside the form,
     * rather than v3's lone card floating on the cool page — see AuthSplit.
     */
    <AuthSplit
      pageClass="login"
      heading="Dhaka's parcels, tracked to the door."
      body="Six zones, live rider positions, and proof of delivery on every handover."
    >
      <h1 className="text-h2 font-semibold tracking-[-0.03em]">Sign in</h1>
      <p className="text-body text-muted mt-5px mb-22px">
        Welcome back. Pick up where you left off.
      </p>

      <form onSubmit={submit} noValidate>
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {/* Error state, not just the happy path. */}
        {(fieldError ?? serverError) ? (
          <p
            role="alert"
            className="text-small text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mb-3"
          >
            {fieldError ?? serverError}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          disabled={login.isPending}
        >
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      {/* v3's `.demo` block, gated behind VITE_SHOW_DEMO_LOGINS. */}
      {SHOW_DEMO_LOGINS ? (
        <div className="mt-14px bg-surface-sunk rounded-md px-15px py-13px">
          <div className="text-micro font-semibold uppercase tracking-[0.11em] text-faint mb-2">
            Demo accounts
          </div>
          {[
            { role: 'Customer', email: 'nusrat@demo.pdms' },
            { role: 'Rider', email: 'rakib@demo.pdms' },
            { role: 'Admin', email: 'admin@demo.pdms' },
          ].map((d) => (
            <button
              key={d.email}
              type="button"
              onClick={() => {
                setEmail(d.email)
                setPassword(DEMO_PASSWORD)
                setFieldError(null)
              }}
              className="w-full flex justify-between items-center py-0.5 text-small hover:text-accent"
            >
              <span className="text-muted">{d.role}</span>
              <span className="mono text-tiny">{d.email}</span>
            </button>
          ))}
          <div className="flex justify-between items-center py-0.5 text-small mt-1 border-t border-border-strong pt-2">
            <span className="text-muted">Password</span>
            <span className="mono text-tiny">{DEMO_PASSWORD}</span>
          </div>
        </div>
      ) : null}

      <p className="text-body text-muted text-center mt-4">
        New here?{' '}
        <Link to="/signup" className="text-accent-hover font-medium hover:underline">
          Create an account
        </Link>
      </p>
    </AuthSplit>
  )
}
