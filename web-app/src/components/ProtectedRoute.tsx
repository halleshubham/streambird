import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PendingApprovalPage } from '../routes/PendingApprovalPage';
import { BirdLoader } from './BirdLoader';

export function ProtectedRoute() {
  const { status, user } = useAuth();

  if (status === 'loading') {
    return <div className="page-loading">
        <BirdLoader loading compact />
      </div>;
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace />;
  }

  // Mirrors AccountGuard's server-side approval gate: an unapproved
  // account (brand-new solo signup OR a new Company Admin -- every
  // non-superadmin role is gated now) would get a 403 from every real API
  // call anyway, so render the pending-approval screen instead of a
  // dashboard that can't do anything. GET /auth/me itself (which is how
  // `user` got populated) is the one route that deliberately keeps
  // working pre-approval.
  if (user && user.role !== 'superadmin' && !user.approvedAt) {
    return <PendingApprovalPage />;
  }

  return <Outlet />;
}
