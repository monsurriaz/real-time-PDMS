import { useNavigate } from 'react-router-dom'
import { Pill } from '@/components/Badge'
import { Card } from '@/components/Card'
import { useLogout, useMe } from '../auth/useAuth'
import { useAgentSelf } from './useAgentSelf'

/**
 * /agent/pending — v3's Auth section. A rider lands here immediately after
 * applying, and RequireRole redirects them back here from every other agent
 * route until an admin approves them (or bounces them away from it once
 * approved). There is no polling: signing out and back in re-checks the
 * same /agents/me the rest of the app reads.
 *
 * No AppShell — a pending rider is not "in" the app yet, and the rail's nav
 * items would only bounce them straight back here if clicked. A plain
 * sign-out link covers the one thing they still need to do from here.
 */

const STEP = (
  n: number,
  title: string,
  detail: string,
  state: 'done' | 'now' | 'later',
) => (
  <div className="flex gap-10px py-6px" key={n}>
    <span
      className={[
        'w-[18px] h-[18px] rounded-full flex-none mt-0.5 text-eyebrow',
        'flex items-center justify-center font-semibold',
        state === 'later' ? 'bg-surface-sunk text-faint' : 'bg-pending text-white',
      ].join(' ')}
    >
      {n}
    </span>
    <div className={state === 'later' ? 'text-faint' : undefined}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-small text-muted">{detail}</p>
    </div>
  </div>
)

export const AgentPendingPage = () => {
  const me = useMe()
  const agent = useAgentSelf()
  const logout = useLogout()
  const navigate = useNavigate()

  const rejected = agent.data?.approvalStatus === 'rejected'
  const firstName = me.data?.name.split(' ')[0] ?? 'there'
  const zone = agent.data?.zones[0] ?? 'your zone'

  const signOut = (): void => {
    logout.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) })
  }

  return (
    <main className="agent-pending min-h-dvh flex justify-center bg-page px-22px py-10">
      <div className="w-full max-w-[400px] flex flex-col justify-center">
        <Card className="text-center" pad={false}>
          <div className="px-6 py-30px">
            <span
              className={`w-[50px] h-[50px] rounded-full mx-auto mb-15px flex items-center justify-center ${
                rejected ? 'bg-failed-bg' : 'bg-pending-bg'
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className={`w-[22px] h-[22px] ${rejected ? 'text-failed-ink' : 'text-pending-ink'}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                {rejected ? (
                  <>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M9 9l6 6M15 9l-6 6" />
                  </>
                ) : (
                  <>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </>
                )}
              </svg>
            </span>

            <h1 className="text-lg font-semibold tracking-[-0.025em]">
              {rejected ? 'Application not approved' : 'Application under review'}
            </h1>
            <p className="text-body text-muted mt-7px">
              {rejected
                ? `Thanks for applying, ${firstName}. An admin reviewed your application and it was not approved this time.`
                : `Thanks, ${firstName}. An admin is checking your details. This usually takes a day.`}
            </p>

            <div className="mt-13px flex justify-center">
              <Pill tone={rejected ? 'failed' : 'pending'}>
                {rejected ? 'Not approved' : 'Pending approval'}
              </Pill>
            </div>

            {!rejected ? (
              <div className="text-left mt-5 border-t border-border pt-4">
                {STEP(1, 'Application received', 'On file', 'done')}
                {STEP(2, 'Under review', 'Verifying NID and vehicle', 'now')}
                {STEP(3, 'Approved', `Jobs in ${zone} start arriving`, 'later')}
              </div>
            ) : null}

            <button
              type="button"
              onClick={signOut}
              disabled={logout.isPending}
              className="w-full min-h-12 text-small font-medium text-muted hover:text-ink mt-5 pt-4 border-t border-border"
            >
              {logout.isPending ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </Card>
      </div>
    </main>
  )
}
