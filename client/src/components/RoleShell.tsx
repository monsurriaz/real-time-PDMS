import { useNavigate } from 'react-router-dom'
import type { Role } from '@pdms/shared'
import { Button } from '@/components/Button'
import { useLogout, useMe } from '@/features/auth/useAuth'

const ROLE_LABEL: Record<Role, string> = {
  customer: 'Customer',
  agent: 'Delivery agent',
  admin: 'Administrator',
}

interface Props {
  title: string
  /** What this screen becomes in a later milestone. */
  next: string
}

/**
 * M1 proof-of-wiring shell, shared by all three role pages.
 *
 * This is deliberately NOT the M0 design — it exists to show that auth,
 * routing and the design tokens are connected. The real role layouts come
 * from docs/parcel-design-system.html.
 */
export const RoleShell = ({ title, next }: Props) => {
  const me = useMe()
  const logout = useLogout()
  const navigate = useNavigate()

  const signOut = (): void => {
    logout.mutate(undefined, {
      onSuccess: () => navigate('/login', { replace: true }),
    })
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-50 bg-paper/[0.88] backdrop-blur-[10px] border-b border-hairline">
        <div className="max-w-[1180px] mx-auto px-5 sm:px-7 h-[62px] flex items-center gap-7">
          <div className="flex items-center gap-[9px]">
            <span className="w-[9px] h-[9px] rounded-[2px] bg-accent rotate-45" />
            <span className="font-display font-bold text-[17px] tracking-[-0.02em]">
              ParcelDelivery
            </span>
          </div>
          <Button
            variant="ink"
            onClick={signOut}
            disabled={logout.isPending}
            className="ml-auto"
          >
            {logout.isPending ? 'Signing out…' : 'Log out'}
          </Button>
        </div>
      </header>

      <main className="max-w-[1180px] mx-auto px-5 sm:px-7 py-9">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] mb-1">
          {title}
        </h1>
        <p className="text-muted text-[13.5px] mb-7">
          Milestone 1 — auth, routing and tokens are wired. {next}
        </p>

        {me.isPending ? (
          <p className="text-muted text-[13.5px]">Loading your account…</p>
        ) : me.data ? (
          <section className="bg-surface border border-hairline rounded-md max-w-[520px]">
            <div className="px-5 py-4 border-b border-hairline">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-faint">
                Signed in as
              </h2>
            </div>
            <dl className="px-5 py-4 grid grid-cols-[92px_1fr] gap-y-3 gap-x-4 text-[14px]">
              <dt className="text-muted">Name</dt>
              <dd className="font-medium">{me.data.name}</dd>

              <dt className="text-muted">Role</dt>
              <dd className="font-medium">{ROLE_LABEL[me.data.role]}</dd>

              <dt className="text-muted">Email</dt>
              {/* Not a number, but an identifier — mono, per section 4. */}
              <dd className="mono text-[13px]">{me.data.email}</dd>

              <dt className="text-muted">Phone</dt>
              <dd className="mono text-[13px]">{me.data.phone}</dd>

              {me.data.zone ? (
                <>
                  <dt className="text-muted">Zone</dt>
                  <dd className="font-medium">{me.data.zone}</dd>
                </>
              ) : null}
            </dl>
          </section>
        ) : (
          // Empty/error state. RequireRole normally redirects before this is
          // reachable, but a session expiring mid-view lands here.
          <p className="text-[13.5px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 max-w-[520px]">
            Your session has ended. Reload to sign in again.
          </p>
        )}
      </main>
    </div>
  )
}
