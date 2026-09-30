import { Outlet, Link } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          StreamBird
        </Link>
        <nav>
          <Link to="/">Dashboard</Link>
          <Link to="/connections">Connections</Link>
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
    </div>
  );
}
