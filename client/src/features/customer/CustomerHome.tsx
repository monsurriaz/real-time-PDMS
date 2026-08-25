import { AppShell, PageHead } from '@/components/AppShell'
import { ParcelList } from './ParcelList'

export const CustomerHome = () => (
  <AppShell title="My parcels">
    <PageHead
      title="My parcels"
      sub="Everything you have sent, and where it is right now."
    />
    <ParcelList />
  </AppShell>
)
