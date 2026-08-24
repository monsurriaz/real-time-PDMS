import { RoleShell } from '@/components/RoleShell'
import { RunList } from './RunList'

export const AgentHome = () => (
  <RoleShell
    title="Today's runs"
    subtitle="Advance each parcel as you go. Record proof before marking anything delivered."
  >
    <RunList />
  </RoleShell>
)
