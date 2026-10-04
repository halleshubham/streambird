import { Outlet, Link, NavLink } from 'react-router-dom';
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
    <div className="app-shell admin-shell">
      <header className="app-header admin-header">
        <Link to="/admin" className="brand">
          <img src="/logo.png" alt="" className="brand-logo" />
          StreamBird <span className="admin-badge">ADMIN</span>
        </Link>
        <nav>
          <NavLink to="/admin" end className={({ isActive }) => (isActive ? 'active' : undefined)}>
            Approvals
          </NavLink>
          <NavLink to="/admin/accounts" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            Companies
          </NavLink>
          <NavLink to="/admin/plans" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            Plans
          </NavLink>
          <NavLink to="/admin/users" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            Users
          </NavLink>
          <NavLink to="/admin/analytics" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            Analytics
          </NavLink>
          <NavLink to="/admin/audit-log" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            Audit log
          </NavLink>
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
