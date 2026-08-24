import { Panel } from '@/components/Panel'
import { RoleShell } from '@/components/RoleShell'

export const AgentHome = () => (
  <RoleShell
    title="Today's runs"
    subtitle="Assignments and status advancing arrive in M3."
  >
    <Panel>
      <p className="text-[13.5px] text-muted">
        Nothing assigned yet — assignment is the next milestone.
      </p>
    </Panel>
  </RoleShell>
)
