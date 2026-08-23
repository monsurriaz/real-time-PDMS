import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { loginInputSchema } from '@pdms/shared'
import { Button } from '@/components/Button'
import { ApiError } from '@/lib/api'
import { homeForRole } from './roles'
import { useLogin, useMe } from './useAuth'

/**
 * M1 login. Validates with the same Zod schema the server uses, so the
 * client's rules cannot drift from the server's — and the server still
 * re-validates, because it must (definition of done).
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
    <main className="min-h-dvh grid place-items-center px-5 py-10">
      <div className="w-full max-w-[380px]">
        <div className="flex items-center gap-[9px] mb-7">
          <span className="w-[9px] h-[9px] rounded-[2px] bg-accent rotate-45" />
          <span className="font-display font-bold text-[17px] tracking-[-0.02em]">
            ParcelDelivery
          </span>
        </div>

        <h1 className="text-[22px] font-semibold tracking-[-0.02em] mb-1">
          Sign in
        </h1>
        <p className="text-muted text-[13.5px] mb-6">
          Use a seeded demo account.
        </p>

        <form
          onSubmit={submit}
          noValidate
          className="bg-surface border border-hairline rounded-md p-5"
        >
          <div className="mb-[15px]">
            <label
              htmlFor="email"
              className="block text-[12.5px] font-medium text-ink-2 mb-1.5"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full font-sans text-[14.5px] text-ink px-[13px] py-[11px]
                         border border-hairline-strong rounded-sm bg-surface outline-none
                         focus:border-accent focus:ring-[3px] focus:ring-accent-tint"
            />
          </div>

          <div className="mb-[15px]">
            <label
              htmlFor="password"
              className="block text-[12.5px] font-medium text-ink-2 mb-1.5"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full font-sans text-[14.5px] text-ink px-[13px] py-[11px]
                         border border-hairline-strong rounded-sm bg-surface outline-none
                         focus:border-accent focus:ring-[3px] focus:ring-accent-tint"
            />
          </div>

          {/* Error state, not just the happy path. */}
          {(fieldError ?? serverError) ? (
            <p
              role="alert"
              className="text-[12.5px] text-failed-ink bg-failed-bg
                         border border-failed/25 rounded-sm px-3 py-2 mb-3"
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
      </div>
    </main>
  )
}
