import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminAnalyticsPage } from '@/features/admin/AdminAnalyticsPage'
import { AdminCodPage } from '@/features/admin/AdminCodPage'
import { AdminHome } from '@/features/admin/AdminHome'
import { AdminPricingPage } from '@/features/admin/AdminPricingPage'
import { AgentHome } from '@/features/agent/AgentHome'
import { BookParcelPage } from '@/features/booking/BookParcelPage'
import { CustomerHome } from '@/features/customer/CustomerHome'
import { LoginPage } from '@/features/auth/LoginPage'
import { RequireRole } from '@/features/auth/RequireRole'
import { TrackParcelPage } from '@/features/tracking/TrackParcelPage'

/**
 * Three role-gated routes plus login. The gate is convenience only — the
 * server enforces the same rules independently.
 */
export const App = () => (
  <Routes>
    <Route path="/login" element={<LoginPage />} />

    <Route
      path="/"
      element={
        <RequireRole roles={['customer']}>
          <CustomerHome />
        </RequireRole>
      }
    />
    <Route
      path="/book"
      element={
        <RequireRole roles={['customer']}>
          <BookParcelPage />
        </RequireRole>
      }
    />
    <Route
      path="/agent"
      element={
        <RequireRole roles={['agent']}>
          <AgentHome />
        </RequireRole>
      }
    />
    <Route
      path="/admin"
      element={
        <RequireRole roles={['admin']}>
          <AdminHome />
        </RequireRole>
      }
    />

    <Route
      path="/admin/analytics"
      element={
        <RequireRole roles={['admin']}>
          <AdminAnalyticsPage />
        </RequireRole>
      }
    />

    <Route
      path="/admin/cod"
      element={
        <RequireRole roles={['admin']}>
          <AdminCodPage />
        </RequireRole>
      }
    />

    <Route
      path="/admin/pricing"
      element={
        <RequireRole roles={['admin']}>
          <AdminPricingPage />
        </RequireRole>
      }
    />

    {/* Customers and admins both track; the server scopes what they can see. */}
    <Route
      path="/track/:parcelId"
      element={
        <RequireRole roles={['customer', 'admin']}>
          <TrackParcelPage />
        </RequireRole>
      }
    />

    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
)
