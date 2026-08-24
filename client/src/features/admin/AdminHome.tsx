import { RoleShell } from '@/components/RoleShell'
import { DeliveryBoard } from './DeliveryBoard'

export const ADMIN_NAV = [
  { to: '/admin', label: 'Operations' },
  { to: '/admin/pricing', label: 'Pricing' },
] as const

export const AdminHome = () => (
  <RoleShell
    title="Operations"
    subtitle="Assign riders, and watch what is moving. Reassignment is possible until a parcel is picked up."
    nav={ADMIN_NAV}
  >
    <DeliveryBoard />
  </RoleShell>
)
