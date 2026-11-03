import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { BirdBusy } from '../BirdBusy';
import { cx } from './helpers';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'live';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Class string for anything that should *look* like a Button (a router `<Link>`, an `<a>`): `<Link className={buttonClass('secondary')}>`. */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string): string {
  return cx('ui-btn', `ui-btn--${variant}`, size !== 'md' && `ui-btn--${size}`, extra);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary (one per screen) | secondary | ghost (quiet) | danger (always behind a confirm()) | live ("Go live" only). */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows the flapping bird, disables the button and sets aria-busy. The label stays so nothing jumps. */
  busy?: boolean;
  /** Full width (phone forms, preset cards). */
  block?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', busy = false, block = false, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(buttonClass(variant, size), block && 'ui-btn--block', className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <BirdBusy /> : icon}
      {children}
    </button>
  );
});
