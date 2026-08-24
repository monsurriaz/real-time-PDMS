import { RoleShell } from '@/components/RoleShell'
import { PricingEditor } from './PricingEditor'

const NAV = [{ to: '/admin', label: 'Pricing' }] as const

export const AdminHome = () => (
  <RoleShell
    title="Pricing"
    subtitle="Changes apply to the next booking. Already-booked parcels keep their price."
    nav={NAV}
  >
    <PricingEditor />
  </RoleShell>
)
