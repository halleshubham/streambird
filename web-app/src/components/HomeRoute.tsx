import { useAuth } from '../context/AuthContext';
import { LandingPage } from '../routes/LandingPage';
import { BirdLoader } from './BirdLoader';
import { prerenderedHtml } from '../lib/prerender';

/**
 * "/" is the public marketing page for everyone, signed in or not (a signed-in visitor is NOT redirected: the header
 * button becomes "Dashboard" instead, see AuthCta). Every authenticated page lives at its own path (/dashboard), so
 * this route doesn't have to live inside ProtectedRoute/AppShell.
 */
export function HomeRoute() {
  const { status } = useAuth();

  if (status === 'loading') {
    // The served HTML already contains the (anonymous) landing page: keep showing it while the session is checked.
    const kept = prerenderedHtml();
    if (kept) return <div dangerouslySetInnerHTML={{ __html: kept }} />;
    return <div className="page-loading">
        <BirdLoader loading compact />
      </div>;
  }

  return <LandingPage />;
}
