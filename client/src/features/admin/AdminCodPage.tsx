import { RoleShell } from '@/components/RoleShell'
import { ADMIN_NAV } from './AdminHome'
import { CodReconciliation } from './CodReconciliation'

export const AdminCodPage = () => (
  <RoleShell
    title="Cash on delivery"
    subtitle="What each rider is holding, what has been handed in, and what will never be collected."
    nav={ADMIN_NAV}
  >
    <CodReconciliation />
  </RoleShell>
)
