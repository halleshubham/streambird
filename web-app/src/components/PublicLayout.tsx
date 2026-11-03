import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import '../styles/public.css';

/** Logo + wordmark, a link to the home page. Used by every public/auth page header. */
export function BrandLink({ small }: { small?: boolean }) {
  return (
    <Link to="/" className={`pub-brand${small ? ' pub-brand--sm' : ''}`}>
      <img src="/logo-256.png" alt="" className="pub-brand-logo" />
      StreamBird
    </Link>
  );
}

/**
 * Shared frame of the sign-in family (login, sign-up, mobile step, approval wait, admin login): a slim header
 * with the logo (and an optional action such as "Log out") and one centred column.
 */
export function AuthLayout({
  children,
  headerAction,
  width = 'normal',
  className,
}: {
  children: ReactNode;
  headerAction?: ReactNode;
  width?: 'normal' | 'wide';
  className?: string;
}) {
  return (
    <div className={`pub-page pub-auth-page${className ? ` ${className}` : ''}`}>
      <header className="pub-header">
        <BrandLink />
        {headerAction}
      </header>
      <main className={`pub-auth-main pub-auth-main--${width}`}>{children}</main>
    </div>
  );
}

/** Page title block of the auth pages. */
export function AuthHeading({ eyebrow, title, lead }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode }) {
  return (
    <div className="pub-auth-heading">
      {eyebrow && <p className="pub-eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {lead && <div className="pub-lead">{lead}</div>}
    </div>
  );
}
