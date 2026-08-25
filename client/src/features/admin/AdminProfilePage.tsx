import { AppShell, PageHead } from '@/components/AppShell'
import { Card } from '@/components/Card'
import { ApiError } from '@/lib/api'
import { useMe } from '../auth/useAuth'
import { AccountTab } from '../profile/AccountTab'
import { PasswordTab } from '../profile/PasswordTab'
import { ProfileShell } from '../profile/ProfileShell'

/** v3's note: "Admin has Account and Password only." No rider details, no
 *  saved addresses — an admin has neither. */
export const AdminProfilePage = () => {
  const me = useMe()

  return (
    <AppShell title="Profile">
      <PageHead title="Profile" sub="Your account and password." />

      {me.isPending ? (
        <Card>
          <p className="text-body text-muted">Loading…</p>
        </Card>
      ) : me.isError || !me.data ? (
        <Card>
          <p role="alert" className="text-sm text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2">
            {me.error instanceof ApiError ? me.error.message : 'Your profile could not be loaded.'}
          </p>
        </Card>
      ) : (
        <ProfileShell
          name={me.data.name}
          roleLine="Administrator"
          tabs={[
            { key: 'account', label: 'Account', content: <AccountTab user={me.data} /> },
            { key: 'password', label: 'Password', content: <PasswordTab /> },
          ]}
        />
      )}
    </AppShell>
  )
}
