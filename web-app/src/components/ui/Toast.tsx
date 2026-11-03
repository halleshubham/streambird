import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { toastDurationMs } from './helpers';
import type { ToastKind } from './helpers';

export interface ToastAction {
  /** Button text: "Undo", "Retry". */
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  /** Override the auto-dismiss time (ms). */
  durationMs?: number;
}

interface ToastDetail extends ToastOptions {
  id?: number;
  kind: ToastKind;
  message: string;
}

const TOAST_EVENT = 'streambird:toast';
const DISMISS_EVENT = 'streambird:toast-dismiss';
let seq = 1;

function show(kind: ToastKind, message: string, opts: ToastOptions = {}): number {
  const id = seq++;
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail: { id, kind, message, ...opts } }));
  return id;
}

/**
 * Show a toast from anywhere (components, helpers, tests: it is a window event, so the <ToastHost/> mounted by
 * ToastProvider picks it up). `toast.success('Preset saved', { action: { label: 'Undo', onClick } })`.
 * Success/info toasts are announced politely (role=status), errors assertively (role=alert).
 */
export const toast = {
  success: (message: string, opts?: ToastOptions) => show('success', message, opts),
  error: (message: string, opts?: ToastOptions) => show('error', message, opts),
  info: (message: string, opts?: ToastOptions) => show('info', message, opts),
  dismiss: (id: number) => window.dispatchEvent(new CustomEvent<number>(DISMISS_EVENT, { detail: id })),
};

export function useToast() {
  return toast;
}

type Live = ToastDetail & { id: number };
const MAX_VISIBLE = 3;

/** Mount once (main.tsx). Renders the toast stack: bottom centre on desktop, above the tab bar on phones. */
export function ToastProvider({ children }: { children?: ReactNode }) {
  const [items, setItems] = useState<Live[]>([]);

  const remove = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  useEffect(() => {
    const onToast = (e: Event) => {
      const d = (e as CustomEvent<ToastDetail>).detail;
      const id = d.id ?? seq++;
      setItems((list) => [...list.filter((t) => t.id !== id), { ...d, id }].slice(-MAX_VISIBLE));
    };
    const onDismiss = (e: Event) => remove((e as CustomEvent<number>).detail);
    window.addEventListener(TOAST_EVENT, onToast);
    window.addEventListener(DISMISS_EVENT, onDismiss);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      window.removeEventListener(DISMISS_EVENT, onDismiss);
    };
  }, [remove]);

  return (
    <>
      {children}
      <div className="ui-toast-host" data-testid="toast-host">
        {items.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={remove} />
        ))}
      </div>
    </>
  );
}

function ToastItem({ toast: t, onDone }: { toast: Live; onDone: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (paused) return;
    timer.current = setTimeout(() => onDone(t.id), t.durationMs ?? toastDurationMs(t.kind, !!t.action));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [paused, t.id, t.durationMs, t.kind, t.action, onDone]);

  return (
    <div
      className={`ui-toast ui-toast--${t.kind}`}
      role={t.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="ui-toast-dot" aria-hidden="true" />
      <span className="ui-toast-msg">{t.message}</span>
      {t.action && (
        <button
          type="button"
          className="ui-toast-action"
          onClick={() => {
            t.action?.onClick();
            onDone(t.id);
          }}
        >
          {t.action.label}
        </button>
      )}
      <button type="button" className="ui-toast-close" aria-label="Dismiss notification" onClick={() => onDone(t.id)}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
