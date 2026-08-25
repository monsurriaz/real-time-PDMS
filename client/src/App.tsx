import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AdminAnalyticsPage } from '@/features/admin/AdminAnalyticsPage'
import { AdminCodPage } from '@/features/admin/AdminCodPage'
import { AdminHome } from '@/features/admin/AdminHome'
import { AdminPricingPage } from '@/features/admin/AdminPricingPage'
import { AgentFinishedPage } from '@/features/agent/AgentFinishedPage'
import { BookParcelPage } from '@/features/booking/BookParcelPage'
import { CustomerHome } from '@/features/customer/CustomerHome'
import { LandingPlaceholder } from '@/features/public/LandingPlaceholder'
import { LoginPage } from '@/features/auth/LoginPage'
import { RequireRole } from '@/features/auth/RequireRole'
import { RiderWorkspace } from '@/features/agent/RiderWorkspace'
import { TrackParcelPage } from '@/features/tracking/TrackParcelPage'

/**
 * Routes, per the table in docs/design-system-v3-meridian.html.
 *
 * Public routes are unprefixed; every authenticated route sits under its role,
 * so the URL always states who you are. The gate is a convenience for the
 * person using the app, NOT a security boundary — the server enforces the same
 * rules independently on every request behind these screens.
 *
 * Nothing 404s. The pre-v3 paths are still live as redirects, because a
 * bookmarked /book landing on a blank page is the kind of breakage a
 * restructure is supposed to avoid rather than cause.
 */

/** `/track/:parcelId` kept its parameter; only its prefix moved. */
const TrackRedirect = () => {
  const { parcelId } = useParams<{ parcelId: string }>()
  return <Navigate to={`/customer/track/${parcelId ?? ''}`} replace />
}

export const App = () => (
  <Routes>
    {/* ---------- public ---------- */}
    <Route path="/" element={<LandingPlaceholder />} />
    <Route path="/login" element={<LoginPage />} />

    {/* ---------- customer ---------- */}
    <Route
      path="/customer/parcels"
      element={
        <RequireRole roles={['customer']}>
          <CustomerHome />
        </RequireRole>
      }
    />
    <Route
      path="/customer/book"
      element={
        <RequireRole roles={['customer']}>
          <BookParcelPage />
        </RequireRole>
      }
    />
    {/* Customers and admins both track; the server scopes what they can see. */}
    <Route
      path="/customer/track/:parcelId"
      element={
        <RequireRole roles={['customer', 'admin']}>
          <TrackParcelPage />
        </RequireRole>
      }
    />

    {/* ---------- agent ---------- */}
    <Route
      path="/agent/runs"
      element={
        <RequireRole roles={['agent']}>
          <RiderWorkspace />
        </RequireRole>
      }
    />
    {/* Same workspace: :id picks which active run shows on the left. */}
    <Route
      path="/agent/runs/:id"
      element={
        <RequireRole roles={['agent']}>
          <RiderWorkspace />
        </RequireRole>
      }
    />
    <Route
      path="/agent/finished"
      element={
        <RequireRole roles={['agent']}>
          <AgentFinishedPage />
        </RequireRole>
      }
    />

    {/* ---------- admin ---------- */}
    <Route
      path="/admin/board"
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

    {/*
      ---------- pre-v3 paths ----------
      Redirects, not re-mounted screens: the address bar has to end up on the
      new URL, or the next reload starts from the old one again.
    */}
    <Route path="/book" element={<Navigate to="/customer/book" replace />} />
    <Route path="/agent" element={<Navigate to="/agent/runs" replace />} />
    <Route path="/admin" element={<Navigate to="/admin/board" replace />} />
    <Route path="/track/:parcelId" element={<TrackRedirect />} />

    {/*
      Anything else goes to the landing placeholder, which forwards a signed-in
      visitor to their own default. Sending an unknown URL straight to a role
      home would be wrong for a signed-out visitor, who has no role yet.
    */}
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
)
