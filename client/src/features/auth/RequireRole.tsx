import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { Role } from '@pdms/shared'
import { homeForRole } from './roles'
import { useMe } from './useAuth'

interface Props {
  roles: readonly Role[]
  children: ReactNode
}

/**
 * Route gate. This is a convenience for the person using the app, NOT a
 * security boundary — every route it wraps is independently enforced by
 * requireAuth/requireRole on the server, because a client-side check is only
 * ever a suggestion (CLAUDE.md section 7).
 */
export const RequireRole = ({ roles, children }: Props) => {
  const me = useMe()

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

  return <>{children}</>
}
