import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PendingApprovalPage } from '../routes/PendingApprovalPage';
import { PhoneStepPage } from '../routes/PhoneStepPage';
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

  // New sign-ups give a mobile number first (older accounts are never asked; see migration 0020). Before the
  // approval check on purpose: the number is how the team can reach someone who is waiting.
  if (user?.needsPhone) {
    return <PhoneStepPage />;
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
