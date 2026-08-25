import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { loginInputSchema } from '@pdms/shared'
import { Button } from '@/components/Button'
import { Field } from '@/components/Field'
import { ApiError } from '@/lib/api'
import { homeForRole } from './roles'
import { useLogin, useMe } from './useAuth'

/** Every seeded account shares one password (scripts/seed.ts). */
const DEMO_PASSWORD = 'pdms-demo-2026'

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
     * v3's `.authwrap` / `.authbox`: a 400px column centred on the cool page,
     * with the wordmark inside the card rather than floating above it. The
     * demo logins sit in a sunk block underneath — this is a course demo and
     * the marker has to be able to get in.
     */
    <main className="min-h-dvh flex justify-center bg-page px-22px py-10">
      <div className="w-full max-w-[400px]">
        <div className="bg-surface border border-border rounded-lg p-6">
          <div className="flex items-center justify-center gap-9px mb-22px font-bold text-mark tracking-[-0.03em]">
            <span className="w-[15px] h-[15px] rounded-mark bg-accent rotate-45" />
            ParcelDelivery
          </div>

          <h1 className="text-h2 font-semibold tracking-[-0.03em] text-center">
            Sign in
          </h1>
          <p className="text-body text-muted text-center mt-5px mb-22px">
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

          {/*
            v3's `.demo` block. Signing up is M6.5c, so the alternative offered
            here is the seeded accounts rather than a link to a screen that
            does not exist yet.
          */}
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
        </div>
      </div>
    </main>
  )
}
