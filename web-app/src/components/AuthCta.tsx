import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { buttonClass } from './ui';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

/**
 * The "log in" call to action on public pages. Anonymous visitors (and the prerendered HTML, which is always the
 * anonymous version) get a link to /login; a signed-in visitor gets a link to /dashboard instead, so the homepage can
 * stay a homepage for them rather than redirecting.
 */
export function AuthCta({
  children,
  authedLabel = 'Dashboard',
  variant,
  authedVariant,
  size = 'md',
  className,
  testId,
}: {
  children: ReactNode;
  authedLabel?: string;
  variant?: Variant;
  authedVariant?: Variant;
  size?: Size;
  className?: string;
  testId?: string;
}) {
  const { status } = useAuth();
  const authed = status === 'authenticated';
  const cls = variant ? buttonClass(authed ? (authedVariant ?? variant) : variant, size) : className;
  return (
    <Link to={authed ? '/dashboard' : '/login'} className={cls} data-testid={authed ? testId : undefined}>
      {authed ? authedLabel : children}
    </Link>
  );
}
