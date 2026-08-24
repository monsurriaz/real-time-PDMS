import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
  /** One line under the heading. */
  subtitle?: string
  /** Links shown in the top bar for this role. */
  nav?: ReadonlyArray<{ to: string; label: string }>
  children: ReactNode
}

/**
 * Page chrome shared by all three roles: the sticky topbar from
 * docs/design-system.html — translucent paper, 62px tall, hairline
 * underneath — plus the wordmark, role-specific nav and sign-out.
 */
export const RoleShell = ({ title, subtitle, nav = [], children }: Props) => {
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
        <div className="max-w-[1180px] mx-auto px-5 sm:px-7 h-[62px] flex items-center gap-5 sm:gap-7">
          <Link to="/" className="flex items-center gap-9px flex-none">
            <span className="w-[9px] h-[9px] rounded-xs bg-accent rotate-45" />
            <span className="font-display font-bold text-[17px] tracking-[-0.02em]">
              ParcelDelivery
            </span>
          </Link>

          <nav className="hidden sm:flex gap-6 ml-auto">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="text-body font-medium text-muted hover:text-ink"
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div
            className={[
              'flex items-center gap-4',
              nav.length > 0 ? '' : 'ml-auto',
            ].join(' ')}
          >
            {me.data ? (
              <span className="hidden md:inline text-[12.5px] text-muted">
                {me.data.name} · {ROLE_LABEL[me.data.role]}
              </span>
            ) : null}
            {/*
              Section 4's 48px floor applies to the whole rider UI, and the top
              bar is part of it. Only the rider's — bumping every role's chrome
              would be a restyle nobody asked for.
            */}
            <Button
              variant="ink"
              {...(me.data?.role === 'agent' ? { size: 'lg' as const } : {})}
              onClick={signOut}
              disabled={logout.isPending}
            >
              {logout.isPending ? 'Signing out…' : 'Log out'}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-[1180px] mx-auto px-5 sm:px-7 py-7 sm:py-9">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] mb-1">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-muted text-body mb-7">{subtitle}</p>
        ) : (
          <div className="mb-7" />
        )}
        {children}
      </main>
    </div>
  )
}
