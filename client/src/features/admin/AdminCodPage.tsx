import { AppShell, PageHead } from '@/components/AppShell'
import { CodReconciliation } from './CodReconciliation'

export const AdminCodPage = () => (
  <AppShell title="Cash on delivery">
    <PageHead
      title="Cash on delivery"
      sub="What each rider is holding, what has been handed in, and what will never be collected."
    />
    <CodReconciliation />
  </AppShell>
)
