import { RoleShell } from '@/components/RoleShell'
import { ADMIN_NAV } from './AdminHome'
import { PricingEditor } from './PricingEditor'

export const AdminPricingPage = () => (
  <RoleShell
    title="Pricing"
    subtitle="Changes apply to the next booking. Already-booked parcels keep their price."
    nav={ADMIN_NAV}
  >
    <PricingEditor />
  </RoleShell>
)
