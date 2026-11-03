import type { ReactNode } from 'react';
import { cx } from './helpers';

/**
 * "Nothing here yet" (and "we couldn't load this" with `tone="error"`, which is announced as an alert).
 * `icon` is any lucide icon element; `action` is usually a <Button> or <Link className={buttonClass()}>.
 */
export function EmptyState({
  icon,
  title,
  children,
  action,
  tone = 'neutral',
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  tone?: 'neutral' | 'error';
  className?: string;
}) {
  return (
    <div className={cx('ui-card ui-empty', tone === 'error' && 'ui-empty--error', className)} role={tone === 'error' ? 'alert' : undefined}>
      {icon && (
        <span className="ui-empty-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <h3 className="ui-empty-title">{title}</h3>
      {children && <p className="ui-empty-body">{children}</p>}
      {action}
    </div>
  );
}
