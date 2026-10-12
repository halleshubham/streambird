import { useCallback, useEffect, useState } from 'react';
import { Outlet, Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { listPendingApprovals } from '../api/superadmin';
import { PENDING_CHANGED_EVENT } from '../lib/adminEvents';

const NAV: { to: string; label: string; end?: boolean; count?: boolean }[] = [
  { to: '/admin', label: 'Approvals', end: true, count: true },
  { to: '/admin/accounts', label: 'Companies' },
  { to: '/admin/plans', label: 'Plans' },
  { to: '/admin/billing', label: 'Billing' },
  { to: '/admin/analytics', label: 'Analytics' },
  { to: '/admin/audit-log', label: 'Audit log' },
];

/**
 * Shared header/nav for every Superadmin page. Deliberately NOT the same
 * component as AppShell (the normal dashboard's shell) -- this is a wholly
 * separate identity/login (see SuperadminRoute), not nested under
 * ProtectedRoute, and must never be confused with it visually either.
 * The nav order follows the day-to-day job: who is waiting, who the
 * customers are, what they pay, how it runs, what was done.
 */
export function AdminShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [pending, setPending] = useState(0);

  const refreshPending = useCallback(() => {
    listPendingApprovals()
      .then((rows) => setPending(rows.length))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Count of signups waiting: refreshed on every page change, on approve/reject, and once a minute.
    // oxlint-disable-next-line react/set-state-in-effect
    refreshPending();
  }, [location.pathname, refreshPending]);

  useEffect(() => {
    window.addEventListener(PENDING_CHANGED_EVENT, refreshPending);
    const timer = setInterval(refreshPending, 60_000);
    return () => {
      window.removeEventListener(PENDING_CHANGED_EVENT, refreshPending);
      clearInterval(timer);
    };
  }, [refreshPending]);

  return (
    <div className="app-shell admin-shell">
      <header className="app-header admin-header">
        <Link to="/admin" className="brand">
          <img src="/logo.png" alt="" className="brand-logo" />
          StreamBird <span className="admin-badge">ADMIN</span>
        </Link>
        <nav aria-label="Admin">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : undefined)}>
              {item.label}
              {item.count && pending > 0 && (
                <span className="admin-nav-count" aria-label={`${pending} waiting`}>
                  {pending}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="app-header-right">
          {user && <span className="user-email">{user.email}</span>}
          <button type="button" className="icon-btn btn-sm" onClick={() => void logout()}>
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
