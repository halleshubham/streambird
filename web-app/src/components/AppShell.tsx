import { Outlet, Link, NavLink } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/dashboard" className="brand">
          <img src="/logo.png" alt="" className="brand-logo" />
          StreamBird
        </Link>
        <nav>
          <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            Dashboard
          </NavLink>
          <NavLink to="/connections" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            Connections
          </NavLink>
          {user?.role === 'company_admin' && (
            <NavLink to="/team" className={({ isActive }) => (isActive ? 'active' : undefined)}>
              Team
            </NavLink>
          )}
        </nav>
        <div className="app-header-right">
          {user && <span className="user-email">{user.email}</span>}
          <button type="button" className="icon-btn" onClick={() => void logout()}>
            <LogOut size={16} /> Log out
          </button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">
        <Link to="/privacy">Privacy Policy</Link> · <Link to="/terms">Terms of Service</Link>
      </footer>
    </div>
  );
}
