import { RoleShell } from '@/components/RoleShell'
import { ADMIN_NAV } from './AdminHome'
import { AnalyticsDashboard } from './AnalyticsDashboard'

export const AdminAnalyticsPage = () => (
  <RoleShell
    title="Analytics"
    subtitle="How the fleet is performing by zone, and what is running late."
    nav={ADMIN_NAV}
  >
    <AnalyticsDashboard />
  </RoleShell>
)
