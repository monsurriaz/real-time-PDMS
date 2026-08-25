import { Pill } from '@/components/Badge'
import { AppShell, PageHead } from '@/components/AppShell'
import { Card } from '@/components/Card'
import { ApiError } from '@/lib/api'
import { useMe } from '../auth/useAuth'
import { AccountTab } from '../profile/AccountTab'
import { PasswordTab } from '../profile/PasswordTab'
import { ProfileShell } from '../profile/ProfileShell'
import { RiderDetailsTab } from './RiderDetailsTab'
import { useAgentSelf } from './useAgentSelf'

const APPROVAL_LABEL: Record<string, string> = {
  approved: 'Approved',
  pending: 'Pending approval',
  rejected: 'Not approved',
}

export const AgentProfilePage = () => {
  const me = useMe()
  const agent = useAgentSelf()

  const loading = me.isPending || agent.isPending
  const error = me.error ?? agent.error
  const failed = me.isError || agent.isError || !me.data || !agent.data

  return (
    <AppShell title="Profile">
      <PageHead title="Profile" sub="Your account, rider details, and password." />

      {loading ? (
        <Card>
          <p className="text-body text-muted">Loading…</p>
        </Card>
      ) : failed || !me.data || !agent.data ? (
        <Card>
          <p role="alert" className="text-sm text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2">
            {error instanceof ApiError ? error.message : 'Your profile could not be loaded.'}
          </p>
        </Card>
      ) : (
        <ProfileShell
          name={me.data.name}
          roleLine={`Rider · ${agent.data.zones[0] ?? 'no zone'} zone`}
          badge={
            <Pill
              tone={
                agent.data.approvalStatus === 'approved'
                  ? 'delivered'
                  : agent.data.approvalStatus === 'pending'
                    ? 'pending'
                    : 'failed'
              }
            >
              {APPROVAL_LABEL[agent.data.approvalStatus]}
            </Pill>
          }
          tabs={[
            { key: 'account', label: 'Account', content: <AccountTab user={me.data} /> },
            {
              key: 'rider',
              label: 'Rider details',
              content: <RiderDetailsTab agent={agent.data} />,
            },
            { key: 'password', label: 'Password', content: <PasswordTab /> },
          ]}
        />
      )}
    </AppShell>
  )
}
