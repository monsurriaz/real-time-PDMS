import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { Role } from '@pdms/shared'
import { useAgentSelf } from '../agent/useAgentSelf'
import { homeForRole } from './roles'
import { useMe } from './useAuth'

interface Props {
  roles: readonly Role[]
  children: ReactNode
}

const AGENT_PENDING_PATH = '/agent/pending'

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
