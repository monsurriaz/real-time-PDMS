import type { ReactNode } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import type { Role } from '@pdms/shared'
import { Button } from '@/components/Button'
import { ApiError } from '@/lib/api'
import { useAgentSelf } from '../agent/useAgentSelf'
import { homeForRole } from './roles'
import { useLogout, useMe } from './useAuth'

interface Props {
  roles: readonly Role[]
  children: ReactNode
}

const AGENT_PENDING_PATH = '/agent/pending'

/**
 * What a suspended account sees instead of being bounced to /login.
 *
 * The bounce was the old behaviour by accident: /auth/me failed, `me.data` was
 * undefined, and the gate could not tell "not signed in" from "signed in and
 * refused". Sending them to a login form they can pass and then be refused
 * behind again reads as a broken app. This says what happened once, and offers
 * the only action that makes sense.
 */
const Suspended = ({ message }: { message: string }) => {
  const logout = useLogout()
  const navigate = useNavigate()

  return (
    <div className="min-h-dvh grid place-items-center p-6 bg-page">
      <div className="max-w-md bg-surface border border-border rounded-lg p-6">
        <h1 className="text-title font-semibold tracking-[-0.03em]">
          Account suspended
        </h1>
        <p role="alert" className="text-body text-ink-2 mt-2">
          {message}
        </p>
        <Button
          className="mt-5"
          disabled={logout.isPending}
          onClick={() =>
            logout.mutate(undefined, {
              onSuccess: () => navigate('/login', { replace: true }),
            })
          }
        >
          {logout.isPending ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </div>
  )
}

/**
 * Route gate. This is a convenience for the person using the app, NOT a
 * security boundary — every route it wraps is independently enforced by
 * requireAuth/requireRole on the server, because a client-side check is only
 * ever a suggestion (CLAUDE.md section 7). The actual thing that keeps a
 * pending rider from working is services/assignment.ts's own filter, not
 * this component.
 *
 * For an agent specifically, this also carries v3's approval redirect: "an
 * unapproved rider is redirected to /agent/pending from every other agent
 * route" — and the reverse, bouncing an already-approved rider AWAY from
 * the pending screen, since it has nothing left to tell them.
 */
export const RequireRole = ({ roles, children }: Props) => {
  const me = useMe()
  const location = useLocation()
  const isAgent = me.data?.role === 'agent'
  // `enabled` matters: a customer or admin route renders this same
  // component, and must not fire a request for an Agent document that
  // does not exist for them.
  const agentSelf = useAgentSelf({ enabled: isAgent })

  // Loading state: no flash of the login screen while /auth/me is in flight.
  if (me.isPending) {
    return (
      <div className="min-h-dvh grid place-items-center">
        <p className="text-muted text-body">Loading…</p>
      </div>
    )
  }

  /**
   * Suspended is its own answer, ahead of the login redirect: the account is
   * perfectly well identified, so "we do not know who you are" would be the
   * wrong thing to tell them. Every other authenticated request behind this
   * gate is refused the same way by requireAuth — this is only the screen that
   * explains it.
   */
  if (me.error instanceof ApiError && me.error.isSuspended) {
    return <Suspended message={me.error.message} />
  }

  if (!me.data) return <Navigate to="/login" replace />

  // Signed in, wrong role — send them where they do belong rather than
  // stranding them on a 403.
  if (!roles.includes(me.data.role)) {
    return <Navigate to={homeForRole(me.data.role)} replace />
  }

  if (isAgent) {
    // Same reasoning as the /auth/me loading state above — do not decide
    // the redirect before the approval status has actually loaded.
    if (agentSelf.isPending) {
      return (
        <div className="min-h-dvh grid place-items-center">
          <p className="text-muted text-body">Loading…</p>
        </div>
      )
    }

    const onPendingPage = location.pathname === AGENT_PENDING_PATH
    const approval = agentSelf.data?.approvalStatus

    // agentSelf.isError falls through rather than blocking — a missing
    // Agent record is a real, separate problem the rider's own screens
    // already surface; this gate should not be the thing stuck loading.
    if (approval && approval !== 'approved' && !onPendingPage) {
      return <Navigate to={AGENT_PENDING_PATH} replace />
    }
    if (approval === 'approved' && onPendingPage) {
      return <Navigate to={homeForRole('agent')} replace />
    }
  }

  return <>{children}</>
}
