import { Outlet, Link } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          <img src="/logo.png" alt="" className="brand-logo" />
          StreamBird
        </Link>
        <nav>
          <Link to="/">Dashboard</Link>
          <Link to="/connections">Connections</Link>
          {user?.role === 'company_admin' && <Link to="/team">Team</Link>}
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
