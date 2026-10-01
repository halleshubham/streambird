import { useAuth } from '../context/AuthContext';

/**
 * Shown instead of the normal app for a Company Admin whose account
 * hasn't been approved by a Superadmin yet -- every AccountGuard-
 * protected API route would 403 them anyway (see AccountGuard's
 * approval gate), so there's nothing useful to render behind it. Polls
 * GET /auth/me (via refresh()) periodically so the page updates on its
 * own once approval happens, without requiring a manual reload.
 */
export function PendingApprovalPage() {
  const { user, logout, refresh } = useAuth();

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/logo.png" alt="StreamBird" className="auth-logo" />
        <h1>Almost there</h1>
        <p>
          Thanks for creating a StreamBird company account
          {user ? ` for ${user.email}` : ''}. A Superadmin needs to approve your account before
          you can start using StreamBird.
        </p>
        <p>This page will update automatically once you're approved.</p>
        <button type="button" onClick={() => void refresh()}>
          Check again
        </button>
        <button type="button" className="link-button" onClick={() => void logout()}>
          Log out
        </button>
      </div>
    </div>
  );
}
