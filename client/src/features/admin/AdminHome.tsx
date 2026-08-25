import { AppShell, PageHead } from '@/components/AppShell'
import { DeliveryBoard } from './DeliveryBoard'
import { FleetMap } from './FleetMap'

export const AdminHome = () => (
  <AppShell title="Live board">
    <PageHead
      title="Live board"
      sub="Every active rider on one map, and the board below. Positions arrive over the same socket the customer screen uses."
    />
    <FleetMap />
    <DeliveryBoard />
  </AppShell>
)
