import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AdminAgentsPage } from '@/features/admin/AdminAgentsPage'
import { AdminAnalyticsPage } from '@/features/admin/AdminAnalyticsPage'
import { AdminCodPage } from '@/features/admin/AdminCodPage'
import { AdminHome } from '@/features/admin/AdminHome'
import { AdminPricingPage } from '@/features/admin/AdminPricingPage'
import { AdminProfilePage } from '@/features/admin/AdminProfilePage'
import { AgentFinishedPage } from '@/features/agent/AgentFinishedPage'
import { AgentPendingPage } from '@/features/agent/AgentPendingPage'
import { AgentProfilePage } from '@/features/agent/AgentProfilePage'
import { BookParcelPage } from '@/features/booking/BookParcelPage'
import { CustomerHome } from '@/features/customer/CustomerHome'
import { CustomerProfilePage } from '@/features/customer/CustomerProfilePage'
import { LandingPage } from '@/features/public/LandingPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { RequireRole } from '@/features/auth/RequireRole'
import { RiderWorkspace } from '@/features/agent/RiderWorkspace'
import { SignupPage } from '@/features/auth/SignupPage'
import { PublicTrackPage } from '@/features/tracking/PublicTrackPage'
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

/**
 * `/track/:id` serves two different eras of link at the same path shape.
 *
 * The pre-v3 bookmark was `/track/:parcelId` — a Mongo ObjectId — redirecting
 * to the authenticated customer screen. v3's `/track/:trackingId` is a NEW,
 * public route at the exact same single-segment shape, so the two cannot be
 * two separate <Route>s (react-router has no way to prefer one over the
 * other by param name — they are the same pattern). A 24-char hex id can
 * never collide with a real tracking ID (CLAUDE.md section 9:
 * `PD-XXXX-XX`), so that shape is what decides which era a given link is
 * from.
 */
const TrackByIdRoute = () => {
  const { id } = useParams<{ id: string }>()
  if (id && /^[0-9a-fA-F]{24}$/.test(id)) {
    return <Navigate to={`/customer/track/${id}`} replace />
  }
  return <PublicTrackPage trackingId={id ?? ''} />
}

export const App = () => (
  <Routes>
    {/* ---------- public ---------- */}
    <Route path="/" element={<LandingPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/signup" element={<SignupPage />} />
    <Route path="/track/:id" element={<TrackByIdRoute />} />

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
    <Route
      path="/customer/profile"
      element={
        <RequireRole roles={['customer']}>
          <CustomerProfilePage />
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
    {/*
      Also wrapped in RequireRole: an approved rider hitting this URL by
      habit bounces to /agent/runs (see RequireRole's own note), and a
      customer or admin gets the usual wrong-role redirect rather than a
      403.
    */}
    <Route
      path="/agent/pending"
      element={
        <RequireRole roles={['agent']}>
          <AgentPendingPage />
        </RequireRole>
      }
    />
    <Route
      path="/agent/profile"
      element={
        <RequireRole roles={['agent']}>
          <AgentProfilePage />
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
      path="/admin/agents"
      element={
        <RequireRole roles={['admin']}>
          <AdminAgentsPage />
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
    <Route
      path="/admin/profile"
      element={
        <RequireRole roles={['admin']}>
          <AdminProfilePage />
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

    {/*
      Anything else goes to the landing page, which now shows the public page
      to everyone — a signed-in visitor gets a link to their own dashboard
      rather than an automatic redirect (v3's own note: they are still
      allowed to read the marketing copy).
    */}
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
)
