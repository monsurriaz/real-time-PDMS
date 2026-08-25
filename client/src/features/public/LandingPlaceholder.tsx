import { Navigate } from 'react-router-dom'
import { useMe } from '@/features/auth/useAuth'
import { homeForRole } from '@/features/auth/roles'

/**
 * `/` is the landing page's address in v3, and the landing page is M6.5c.
 *
 * Until it exists this forwards a signed-in visitor to their own default and
 * sends everyone else to sign in. Note that this is deliberately NOT v3's
 * eventual behaviour — v3 says a signed-in user visiting `/` should see the
 * public page with a link to their dashboard, because a signed-in person is
 * still allowed to read the marketing copy. That only becomes possible once
 * there is copy to read, so M6.5c replaces this file rather than editing it.
 */
export const LandingPlaceholder = () => {
  const me = useMe()

  if (me.isPending) {
    return (
      <div className="min-h-dvh grid place-items-center bg-page">
        <p className="text-muted text-body">Loading…</p>
      </div>
    )
  }

  return <Navigate to={me.data ? homeForRole(me.data.role) : '/login'} replace />
}
