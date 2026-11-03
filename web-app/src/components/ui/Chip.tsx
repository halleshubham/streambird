import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cx } from './helpers';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Filled purple (a chosen destination / filter). Sets aria-pressed when the chip is a toggle. */
  selected?: boolean;
  /** White with a border (a neutral option such as "720p"). */
  outline?: boolean;
}

/** A pill-shaped toggle/option button. For a non-interactive label use <Badge>. */
export function Chip({ selected, outline, className, children, type = 'button', ...rest }: ChipProps) {
  return (
    <button
      type={type}
      className={cx('ui-chip', selected && 'ui-chip--on', outline && 'ui-chip--outline', className)}
      aria-pressed={selected === undefined ? undefined : selected}
      {...rest}
    >
      {children}
    </button>
  );
}

export type BadgeTone = 'live' | 'scheduled' | 'ended' | 'success' | 'warning' | 'neutral' | 'pro';

/** Status pill. tone: live (red) | scheduled (purple) | ended (grey) | success/connected (green) | warning/pending (amber) | neutral | pro (solid purple). */
export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
  ...rest
}: { tone?: BadgeTone; dot?: boolean; children: ReactNode } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cx('ui-badge', `ui-badge--${tone}`, className)} {...rest}>
      {dot && <span className="ui-badge-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
