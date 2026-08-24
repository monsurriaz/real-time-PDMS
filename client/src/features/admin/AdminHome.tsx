import { RoleShell } from '@/components/RoleShell'
import { DeliveryBoard } from './DeliveryBoard'
import { FleetMap } from './FleetMap'

export const ADMIN_NAV = [
  { to: '/admin', label: 'Operations' },
  { to: '/admin/pricing', label: 'Pricing' },
] as const

export const AdminHome = () => (
  <RoleShell
    title="Operations"
    subtitle="Every active rider on one map, and the board below. Positions arrive over the same socket the customer screen uses."
    nav={ADMIN_NAV}
  >
    {/* The map sits above the existing board — the table is untouched. */}
    <FleetMap />
    <DeliveryBoard />
  </RoleShell>
)
