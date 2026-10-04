import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BirdLoader } from './BirdLoader';

/**
 * Deliberately separate from ProtectedRoute/AppShell -- this is a wholly
 * different identity (the fixed Superadmin operator, not a dashboard
 * user), gated on role rather than merely "logged in". Uses the SAME
 * AuthContext/session cookie under the hood (superadmin-login mints the
 * exact same kind of session everything else does), just its own check
 * and its own redirect target (/admin/login, not /login).
 */
export function SuperadminRoute() {
  const { status, user } = useAuth();

  if (status === 'loading') {
    return <div className="page-loading">
        <BirdLoader loading compact />
      </div>;
  }

  if (status === 'anonymous' || user?.role !== 'superadmin') {
    return <Navigate to="/admin/login" replace />;
  }

  return <Outlet />;
}
