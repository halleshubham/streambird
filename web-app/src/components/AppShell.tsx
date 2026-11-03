import { useEffect, useState } from 'react';
import { Outlet, Link, NavLink, useLocation } from 'react-router-dom';
import { CookieSettingsLink } from './CookieSettingsLink';
import { CalendarClock, ExternalLink, Home, LogOut, MoreHorizontal, Palette, Plug } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { DocsLink } from './DocsLink';
import { BottomSheet, Button } from './ui';
import { initialsFor } from './ui/helpers';
import { docsUrl } from '../docs';

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : undefined);

/**
 * Host app shell. Desktop/tablet: sticky header (brand, nav pills, email + Log out). Phones (<= 640 px): slim header
 * (brand + account avatar) and a fixed bottom tab bar: Home, Upcoming, Connect, Brand, More (Billing, Docs, Team, Log out).
 * Both navs are always in the DOM; CSS shows one, so the desktop link names (Dashboard, Upcoming, Connections, Brand,
 * Billing, Team, Log out) that tests use stay reachable and only one set is ever visible to a user or a screen reader.
 */
export function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sheet, setSheet] = useState<null | 'account' | 'more'>(null);

  // Tell the toast host and the cookie strip there is a tab bar to sit above (CSS: body[data-tabbar]).
  useEffect(() => {
    document.body.dataset.tabbar = '1';
    return () => {
      delete document.body.dataset.tabbar;
    };
  }, []);

  const isAdmin = user?.role === 'company_admin';
  const moreActive = location.pathname.startsWith('/billing') || location.pathname.startsWith('/team');
  const close = () => setSheet(null);

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/dashboard" className="brand">
          <img src="/logo.png" alt="" className="brand-logo" />
          StreamBird
        </Link>
        <nav aria-label="Main" className="app-nav">
          <NavLink to="/dashboard" className={navClass}>
            Dashboard
          </NavLink>
          <NavLink to="/streams/upcoming" className={navClass}>
            Upcoming
          </NavLink>
          <NavLink to="/connections" className={navClass}>
            Connections
          </NavLink>
          <NavLink to="/brand" className={navClass}>
            Brand
          </NavLink>
          <NavLink to="/billing" className={navClass}>
            Billing
          </NavLink>
          <DocsLink className="nav-docs-link" />
          {isAdmin && (
            <NavLink to="/team" className={navClass}>
              Team
            </NavLink>
          )}
        </nav>
        <div className="app-header-right">
          {user && <span className="user-email">{user.email}</span>}
          <Button variant="ghost" size="sm" className="app-logout" icon={<LogOut size={16} aria-hidden="true" />} onClick={() => void logout()}>
            Log out
          </Button>
          <button type="button" className="app-avatar" aria-label="Account menu" aria-haspopup="dialog" onClick={() => setSheet('account')}>
            {initialsFor(user?.email)}
          </button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">
        <DocsLink /> · <Link to="/privacy">Privacy Policy</Link> · <Link to="/terms">Terms of Service</Link>
        <CookieSettingsLink />
      </footer>

      <nav className="tab-bar" aria-label="Tab bar">
        <NavLink to="/dashboard" className={navClass}>
          <Home size={22} aria-hidden="true" />
          Home
        </NavLink>
        <NavLink to="/streams/upcoming" className={navClass}>
          <CalendarClock size={22} aria-hidden="true" />
          Upcoming
        </NavLink>
        <NavLink to="/connections" className={navClass}>
          <Plug size={22} aria-hidden="true" />
          Connect
        </NavLink>
        <NavLink to="/brand" className={navClass}>
          <Palette size={22} aria-hidden="true" />
          Brand
        </NavLink>
        <button type="button" className={moreActive ? 'active' : undefined} aria-haspopup="dialog" onClick={() => setSheet('more')}>
          <MoreHorizontal size={22} aria-hidden="true" />
          More
        </button>
      </nav>

      <BottomSheet open={sheet !== null} onClose={close} title={sheet === 'more' ? 'More' : 'Account'} className="more-sheet" testId="more-sheet">
        {user && <p className="more-sheet-email">{user.email}</p>}
        <ul className="more-sheet-list">
          {sheet === 'more' && (
            <>
              <li>
                <Link to="/billing" onClick={close}>
                  Billing
                </Link>
              </li>
              <li>
                <a href={docsUrl()} target="_blank" rel="noopener noreferrer" onClick={close}>
                  Docs <ExternalLink size={14} aria-hidden="true" />
                </a>
              </li>
              {isAdmin && (
                <li>
                  <Link to="/team" onClick={close}>
                    Team
                  </Link>
                </li>
              )}
            </>
          )}
          <li>
            <button
              type="button"
              className="more-sheet-logout"
              onClick={() => {
                close();
                void logout();
              }}
            >
              <LogOut size={18} aria-hidden="true" /> Log out
            </button>
          </li>
        </ul>
      </BottomSheet>
    </div>
  );
}
