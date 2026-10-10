import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Mail, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BirdBusy } from '../components/BirdBusy';

const SUPPORT_EMAIL = 'support@shackyapps.in';
/** How often the page asks the server whether the account has been approved. */
export const APPROVAL_POLL_MS = 30_000;

/**
 * Shown instead of the normal app for any account that a Superadmin has not approved yet (a new solo signup
 * or a new Company Admin): every AccountGuard-protected route would 403 it anyway, so there is nothing
 * useful to render behind it. It asks GET /auth/me (via refresh()) every 30 s, so the page turns into the
 * dashboard on its own the moment approval happens, and "Check again" says what it found.
 */
export function PendingApprovalPage() {
  const { user, logout, refresh } = useAuth();
  const [checking, setChecking] = useState(false);
  const [checkedNote, setCheckedNote] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), APPROVAL_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const checkAgain = useCallback(async () => {
    setChecking(true);
    setCheckedNote(null);
    try {
      await refresh();
      // Still here after a refresh means still not approved (an approved account leaves this page).
      setCheckedNote('Checked just now: your studio is still being set up. We will let you in as soon as it is ready.');
    } finally {
      setChecking(false);
    }
  }, [refresh]);

  const subject = encodeURIComponent('My StreamBird studio setup');
  const body = encodeURIComponent(`Hi, I signed up as ${user?.email ?? 'a new user'} and am waiting for my studio to be set up.`);

  return (
    <div className="auth-page pending-page">
      <div className="pending-card">
        <div className="pending-scene" aria-hidden="true">
          <span className="pending-glow" />
          <span className="pending-ring pending-ring--1" />
          <span className="pending-ring pending-ring--2" />
          <img src="/logo.png" alt="" className="pending-bird" />
          <span className="pending-spark pending-spark--1" />
          <span className="pending-spark pending-spark--2" />
          <span className="pending-spark pending-spark--3" />
          <div className="pending-frames">
            <i />
            <i />
            <i />
          </div>
        </div>

        <h1>Your studio is being set up!</h1>
        <p className="pending-lead">
          Thanks for signing up{user ? ` as ${user.email}` : ''}. Our team is getting everything ready for you.
        </p>

        <ol className="pending-steps" aria-label="Setup progress">
          <li className="done">
            <CheckCircle2 size={18} /> Account created
          </li>
          <li className="done">
            <CheckCircle2 size={18} /> Email verified
          </li>
          <li className="doing">
            <span className="pending-dot" aria-hidden="true" /> Studio being set up by our team
          </li>
          <li className="todo">
            <span className="pending-ring-dot" aria-hidden="true" /> Ready to go live
          </li>
        </ol>

        <p className="pending-note">
          Check back in a little while. This page updates by itself the moment you are in, and we will email you
          {user ? ` at ${user.email}` : ''} as soon as your studio is ready.
        </p>

        <button type="button" className="pending-check" disabled={checking} onClick={() => void checkAgain()}>
          {checking ? <BirdBusy /> : <RefreshCw size={16} />} Check again
        </button>
        {checkedNote && (
          <p className="pending-checked" role="status">
            {checkedNote}
          </p>
        )}

        <p className="pending-help">
          Need it sooner, or have a question?{' '}
          <a href={`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`} className="chip-link chip-link--sm">
            <Mail size={13} /> {SUPPORT_EMAIL}
          </a>
        </p>

        <button type="button" className="link-button" onClick={() => void logout()}>
          Log out
        </button>
      </div>
    </div>
  );
}
