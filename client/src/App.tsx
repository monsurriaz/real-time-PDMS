import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminHome } from '@/features/admin/AdminHome'
import { AgentHome } from '@/features/agent/AgentHome'
import { BookParcelPage } from '@/features/booking/BookParcelPage'
import { CustomerHome } from '@/features/customer/CustomerHome'
import { LoginPage } from '@/features/auth/LoginPage'
import { RequireRole } from '@/features/auth/RequireRole'

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

    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
)
