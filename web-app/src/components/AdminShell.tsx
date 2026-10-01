import { Outlet, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Shared header/nav for every Superadmin page -- factored out of what
 * used to be AdminDashboardPage's own inline header so new admin pages
 * (accounts directory, user management, analytics, audit log) don't each
 * reinvent it. Deliberately NOT the same component as AppShell (the
 * normal dashboard's shell) -- this is a wholly separate identity/login
 * (see SuperadminRoute), not nested under ProtectedRoute, and must never
 * be confused with it visually either.
 */
export function AdminShell() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">StreamBird Admin</span>
        <nav>
          <Link to="/admin">Approvals</Link>
          <Link to="/admin/accounts">Companies</Link>
          <Link to="/admin/users">Users</Link>
          <Link to="/admin/analytics">Analytics</Link>
          <Link to="/admin/audit-log">Audit log</Link>
        </nav>
        <div className="app-header-right">
          {user && <span className="user-email">{user.email}</span>}
          <button type="button" className="icon-btn" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
