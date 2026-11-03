import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cx } from './helpers';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** plain (white) | soft (lilac tint, nudges) | hero (purple gradient: hero and the primary feature card only) */
  tone?: 'plain' | 'soft' | 'hero';
  as?: ElementType;
  /** Tighter padding (phone lists, dense admin cards). */
  compact?: boolean;
  children?: ReactNode;
}

/** The standard container: white surface, 1px border, 14px radius. Pass `aria-labelledby` / `aria-label` when it is a landmark-ish section. */
export function Card({ tone = 'plain', as: Tag = 'section', compact = false, className, children, ...rest }: CardProps) {
  return (
    <Tag className={cx('ui-card', tone !== 'plain' && `ui-card--${tone}`, compact && 'ui-card--compact', className)} {...rest}>
      {children}
    </Tag>
  );
}

/** Alias kept for readability where the old code said "panel". */
export const Panel = Card;
