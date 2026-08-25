import { AppShell, PageHead } from '@/components/AppShell'
import { PricingEditor } from './PricingEditor'

export const AdminPricingPage = () => (
  <AppShell title="Pricing" pageClass="admin-pricing">
    <PageHead
      title="Pricing"
      sub="Changes apply to the next booking. Already-booked parcels keep their price."
    />
    <PricingEditor />
  </AppShell>
)
