import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LandingPage } from '../routes/LandingPage';
import { BirdLoader } from './BirdLoader';

/**
 * "/" is the one route whose content depends on who's looking: an
 * anonymous visitor gets the public marketing page, a logged-in user gets
 * sent straight to their dashboard. Every other authenticated page lives
 * at its own path (dashboard moved to /dashboard) so this split doesn't
 * have to live inside ProtectedRoute/AppShell, which assume "anonymous ->
 * redirect to /login" for everything they wrap.
 */
export function HomeRoute() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <div className="page-loading">
        <BirdLoader loading compact />
      </div>;
  }

  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }

  return <LandingPage />;
}
