import { AppShell, PageHead } from '@/components/AppShell'
import { AnalyticsDashboard } from './AnalyticsDashboard'

export const AdminAnalyticsPage = () => (
  <AppShell title="Analytics" pageClass="admin-analytics">
    <PageHead
      title="Analytics"
      sub="How the fleet is performing by zone, and what is running late."
    />
    <AnalyticsDashboard />
  </AppShell>
)
