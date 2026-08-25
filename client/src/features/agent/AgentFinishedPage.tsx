import { AppShell, PageHead } from '@/components/AppShell'
import { FinishedRuns } from './FinishedRuns'

export const AgentFinishedPage = () => (
  <AppShell title="Finished" pageClass="agent-finished">
    <PageHead title="Finished" sub="Every run you've closed out, delivered or not." />
    <FinishedRuns />
  </AppShell>
)
