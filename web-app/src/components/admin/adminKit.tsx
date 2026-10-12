import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Resolution, UserRole } from '../../types/api';

/**
 * Small building blocks shared by every Superadmin page, so a page is just
 * "header + data" and the markup/CSS for tables, badges, empty states and
 * dates exists once. Styles live in index.css under "Superadmin".
 */

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <header className="admin-page-head">
      {back && (
        <Link to={back.to} className="admin-back">
          ← {back.label}
        </Link>
      )}
      <div className="admin-page-head-row">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="admin-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="admin-page-actions">{actions}</div>}
      </div>
    </header>
  );
}

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

/** A titled card; use `danger` for the destructive actions of a page. */
export function Section({ title, hint, children, danger = false }: { title?: ReactNode; hint?: ReactNode; children: ReactNode; danger?: boolean }) {
  return (
    <section className={`panel admin-section${danger ? ' admin-section--danger' : ''}`}>
      {title && <h2>{title}</h2>}
      {hint && <p className="admin-hint">{hint}</p>}
      {children}
    </section>
  );
}

/** Horizontally scrollable table with the shared look. `tall` caps long lists at about a screen and scrolls inside, header pinned. */
export function DataTable({ children, caption, tall = false }: { children: ReactNode; caption?: string; tall?: boolean }) {
  return (
    <div className={`table-scroll admin-table-wrap${tall ? ' admin-table-wrap--tall' : ''}`}>
      <table className="data-table admin-table">
        {caption && <caption className="visually-hidden">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="empty-state admin-empty">{children}</p>;

/** "Showing 25 of 140" with a button that reveals more. */
export function ShowMore({ shown, total, step, onMore }: { shown: number; total: number; step: number; onMore: () => void }) {
  if (total <= shown) return null;
  return (
    <p className="admin-showmore">
      Showing {shown} of {total}.{' '}
      <button type="button" className="btn-sm btn-ghost" onClick={onMore}>
        Show {Math.min(step, total - shown)} more
      </button>
    </p>
  );
}

// ---- formatting ----------------------------------------------------------

const DATE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const DATE_TIME = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** "12 Oct 2026"; "—" for nothing. */
export const fmtDate = (iso: string | null | undefined) => (iso ? DATE.format(new Date(iso)) : '—');

/** "12 Oct 2026, 11:57"; the full local time is the tooltip. */
export function When({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <>—</>;
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()}>
      {DATE_TIME.format(new Date(iso))}
    </time>
  );
}

export const ROLE_LABEL: Record<UserRole, string> = {
  superadmin: 'Superadmin',
  company_admin: 'Company admin',
  user: 'Solo user',
};

export const RESOLUTION_LABEL: Record<Resolution, string> = {
  sd: 'SD 360p',
  hd: 'HD 720p',
  fhd: 'Full HD 1080p',
  qhd: '2K 1440p',
};

/** 'approve_user' -> 'Approve user'. */
export const humanize = (s: string) => {
  const t = s.replace(/[_.:-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** First 8 characters of an id, for places where the full uuid is noise. */
export const shortId = (id: string) => id.slice(0, 8);

/** Plan keys are lowercase identifiers; show them as names ("day_pass" -> "Day pass"). */
export const planLabel = (key: string, plans?: { key: string; name: string }[]) => plans?.find((p) => p.key === key)?.name ?? humanize(key);

/** Payment / subscription status -> badge colour. */
export function statusTone(status: string): BadgeTone {
  if (['paid', 'captured', 'active', 'authenticated', 'completed'].includes(status)) return 'success';
  if (['failed', 'halted', 'cancelled', 'expired'].includes(status)) return 'danger';
  if (['pending', 'created', 'cancelling'].includes(status)) return 'warning';
  return 'neutral';
}
