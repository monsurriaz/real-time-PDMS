import { RoleShell } from '@/components/RoleShell'
import { ParcelList } from './ParcelList'

const NAV = [
  { to: '/', label: 'My parcels' },
  { to: '/book', label: 'Book' },
] as const

export const CustomerHome = () => (
  <RoleShell title="Your parcels" nav={NAV}>
    <ParcelList />
  </RoleShell>
)
