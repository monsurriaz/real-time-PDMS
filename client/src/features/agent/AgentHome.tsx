import { AppShell, PageHead } from '@/components/AppShell'
import { RunList } from './RunList'

/**
 * The rider workspace is rebuilt in M6.5b — v3 replaces this single column of
 * stacked cards with a route map beside the active delivery. This session only
 * moves it inside the new shell and onto the new tokens, so it is not broken
 * while the rest of the app changes underneath it.
 */
export const AgentHome = () => (
  <AppShell title="Today's runs">
    <PageHead
      title="Today's runs"
      sub="Advance each parcel as you go. Record proof before marking anything delivered."
    />
    <RunList />
  </AppShell>
)
