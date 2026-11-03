import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { Button } from './Button';
import { Modal } from './Modal';
import { typedConfirmationMatches } from './helpers';

export interface ConfirmOptions {
  /** The dialog's accessible name. Name the thing: `Delete "Friday Q and A"?` */
  title: string;
  body?: ReactNode;
  /** A boxed line under the body (the account, the stream, the list of people). */
  details?: ReactNode;
  /** Label of the confirm button; it is that button's accessible name. Repeat the verb: "Delete stream". */
  confirmLabel?: string;
  /** Label of the cancel button (default "Cancel"). */
  cancelLabel?: string;
  /** Red confirm button, `role=alertdialog`, and focus starts on Cancel. */
  destructive?: boolean;
  /** Ask the person to type this (a company name, "DELETE") before the confirm button turns on. */
  typeToConfirm?: string;
  /** Label above the typed-confirmation input (default `Type "<phrase>" to confirm`). */
  typeToConfirmLabel?: string;
}

type Pending = { id: number; opts: ConfirmOptions; resolve: (ok: boolean) => void };
type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

// Module-level handle so non-component code (helpers in lib/, event handlers outside a hook) can `await confirm(...)`.
let activeConfirm: ConfirmFn | null = null;

/**
 * Replaces window.confirm (BANNED in web-app/src). Resolves true when the person confirms, false on Cancel,
 * Esc or when the provider is not mounted.
 *   if (!(await confirm({ title: 'Delete "Friday show"?', body: 'This cannot be undone.', confirmLabel: 'Delete stream', destructive: true }))) return;
 */
export const confirm: ConfirmFn = (opts) => {
  if (!activeConfirm) {
    console.error('confirm() called but <ConfirmProvider> is not mounted');
    return Promise.resolve(false);
  }
  return activeConfirm(opts);
};

/** Same function as `confirm`, from context (for components that prefer a hook). */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext) ?? confirm;
}

/** Mount once near the root (main.tsx). Calls made while a dialog is open queue up and show one after another. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Pending[]>([]);
  const nextId = useRef(1);

  const ask = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setQueue((q) => [...q, { id: nextId.current++, opts, resolve }]);
    });
  }, []);

  useEffect(() => {
    activeConfirm = ask;
    return () => {
      if (activeConfirm === ask) activeConfirm = null;
    };
  }, [ask]);

  const current = queue[0];
  const settle = useCallback((ok: boolean) => {
    setQueue((q) => {
      q[0]?.resolve(ok);
      return q.slice(1);
    });
  }, []);

  const value = useMemo(() => ask, [ask]);
  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {current && <ConfirmDialog key={current.id} opts={current.opts} onSettle={settle} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ opts, onSettle }: { opts: ConfirmOptions; onSettle: (ok: boolean) => void }) {
  const { title, body, details, destructive = false, typeToConfirm, cancelLabel = 'Cancel' } = opts;
  const confirmLabel = opts.confirmLabel ?? 'Confirm';
  const [typed, setTyped] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const typedRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const typedOk = !typeToConfirm || typedConfirmationMatches(typed, typeToConfirm);

  // Safe default: a destructive dialog starts on Cancel (or on the typed field), an ordinary one on the confirm button.
  const initialFocus = typeToConfirm ? typedRef : destructive ? cancelRef : confirmRef;

  return (
    <Modal
      open
      onClose={() => onSettle(false)}
      title={title}
      role={destructive ? 'alertdialog' : 'dialog'}
      description={body}
      initialFocus={initialFocus}
      className="ui-confirm"
      testId="confirm-dialog"
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" data-testid="confirm-cancel" onClick={() => onSettle(false)}>
            {cancelLabel}
          </Button>
          <Button ref={confirmRef} data-testid="confirm-accept" variant={destructive ? 'danger' : 'primary'} disabled={!typedOk} onClick={() => onSettle(true)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <span className={`ui-confirm-icon${destructive ? ' ui-confirm-icon--danger' : ''}`} aria-hidden="true">
        {destructive ? <AlertTriangle size={20} /> : <Check size={20} />}
      </span>
      {details && <div className="ui-confirm-details">{details}</div>}
      {typeToConfirm && (
        <div className="ui-field">
          <label className="ui-field-label" htmlFor="ui-confirm-typed">
            {opts.typeToConfirmLabel ?? `Type "${typeToConfirm}" to confirm`}
          </label>
          <input
            id="ui-confirm-typed"
            ref={typedRef}
            className="ui-input"
            value={typed}
            placeholder={typeToConfirm}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && typedOk) onSettle(true);
            }}
          />
        </div>
      )}
    </Modal>
  );
}
