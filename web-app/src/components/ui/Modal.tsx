import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { FOCUSABLE_SELECTOR, cx, nextFocusIndex } from './helpers';

export type ModalVariant = 'center' | 'drawer' | 'sheet';

export interface ModalProps {
  open: boolean;
  /** Called on Esc, on a click on the scrim and from the close button. Not called when `dismissible` is false. */
  onClose: () => void;
  /** The dialog's accessible name (and its visible heading unless `hideTitle`). */
  title: ReactNode;
  hideTitle?: boolean;
  /** Descriptive text that screen readers read after the title (becomes aria-describedby). */
  description?: ReactNode;
  /** `alertdialog` for destructive confirmations: Esc still cancels but a scrim click does not. */
  role?: 'dialog' | 'alertdialog';
  /** center = modal box; drawer = panel from the right edge; sheet = bottom sheet (full width on phones). */
  variant?: ModalVariant;
  /** Esc / scrim click / close button dismiss the dialog (default true; confirmations that must be answered pass false for the scrim only via role). */
  dismissible?: boolean;
  /** Element to focus on open. Default: the first focusable element, else the dialog itself. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Buttons row, rendered under the body. */
  footer?: ReactNode;
  className?: string;
  testId?: string;
  children?: ReactNode;
}

let scrollLocks = 0;
function lockScroll(): () => void {
  if (scrollLocks++ === 0) document.documentElement.classList.add('ui-scroll-locked');
  return () => {
    if (--scrollLocks === 0) document.documentElement.classList.remove('ui-scroll-locked');
  };
}

/**
 * The one dialog primitive: portal to <body>, aria-modal, focus moves in on open, Tab/Shift+Tab are trapped,
 * Esc closes, focus returns to what opened it, the page behind does not scroll. Drawer and BottomSheet are
 * just variants (see below). ConfirmDialog is built on it.
 */
export function Modal({
  open,
  onClose,
  title,
  hideTitle = false,
  description,
  role = 'dialog',
  variant = 'center',
  dismissible = true,
  initialFocus,
  footer,
  className,
  testId,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  // Keep the latest onClose without re-running the open effect (a new inline function each render must not steal focus).
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlock = lockScroll();
    const dialog = dialogRef.current;
    const target = initialFocus?.current ?? dialog?.querySelector<HTMLElement>('[data-autofocus]') ?? dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? dialog;
    target?.focus();
    return () => {
      unlock();
      // Hand focus back to whatever opened the dialog (if it is still on the page).
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open, initialFocus]);

  if (!open) return null;

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      closeRef.current();
      return;
    }
    if (e.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const idx = nextFocusIndex(items.indexOf(document.activeElement as HTMLElement), items.length, e.shiftKey);
    // Only take over at the ends (or when focus is outside); inside the list the browser's own order is right.
    const current = items.indexOf(document.activeElement as HTMLElement);
    const atEdge = current < 0 || (e.shiftKey ? current === 0 : current === items.length - 1);
    if (atEdge) {
      e.preventDefault();
      items[idx]?.focus();
    }
  }

  return createPortal(
    <div
      className={cx('ui-scrim', `ui-scrim--${variant}`)}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible && role !== 'alertdialog') closeRef.current();
      }}
    >
      <div
        ref={dialogRef}
        className={cx('ui-modal', `ui-modal--${variant}`, className)}
        role={role}
        aria-modal="true"
        aria-labelledby={hideTitle ? undefined : titleId}
        aria-label={hideTitle && typeof title === 'string' ? title : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        data-testid={testId}
        onKeyDown={onKeyDown}
      >
        {variant === 'sheet' && <span className="ui-sheet-grip" aria-hidden="true" />}
        <h2 id={titleId} className={cx('ui-modal-title', hideTitle && 'ui-sr-only')}>
          {title}
        </h2>
        {description && (
          <div id={descId} className="ui-modal-desc">
            {description}
          </div>
        )}
        {children}
        {footer && <div className="ui-modal-actions">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A panel sliding in from the right edge (edit forms, plan details). */
export function Drawer(props: Omit<ModalProps, 'variant'>) {
  return <Modal {...props} variant="drawer" />;
}

/** A sheet from the bottom edge (the phone "More" menu, pickers). Full width on phones, a centred box on desktop. */
export function BottomSheet(props: Omit<ModalProps, 'variant'>) {
  return <Modal {...props} variant="sheet" />;
}
