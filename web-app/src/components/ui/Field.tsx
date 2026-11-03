import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from './helpers';

interface FieldShellProps {
  label: ReactNode;
  hint?: ReactNode;
  /** An error message: the control gets aria-invalid and the message is announced (role=alert). */
  error?: ReactNode;
  id?: string;
  className?: string;
  children: (control: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
}

/**
 * Label + control + hint + error with the ids wired up. Use it with any control:
 *   <Field label="Stream title" error={err}>{(c) => <input {...c} value=... />}</Field>
 * or use the ready-made Input / TextArea / SelectField below. The label is a real <label for>,
 * so `getByLabel('Stream title')` keeps working.
 */
export function Field({ label, hint, error, id, className, children }: FieldShellProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errId = error ? `${fieldId}-err` : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('ui-field', !!error && 'ui-field--error', className)}>
      <label className="ui-field-label" htmlFor={fieldId}>
        {label}
      </label>
      {children({ id: fieldId, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && (
        <p id={hintId} className="ui-field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="ui-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type Extra = { label: ReactNode; hint?: ReactNode; error?: ReactNode; fieldClassName?: string };

export function Input({ label, hint, error, fieldClassName, className, id, ...rest }: Extra & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error} id={id} className={fieldClassName}>
      {(c) => <input className={cx('ui-input', className)} {...c} {...rest} />}
    </Field>
  );
}

export function TextArea({ label, hint, error, fieldClassName, className, id, ...rest }: Extra & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} hint={hint} error={error} id={id} className={fieldClassName}>
      {(c) => <textarea className={cx('ui-input ui-textarea', className)} {...c} {...rest} />}
    </Field>
  );
}

export function SelectField({ label, hint, error, fieldClassName, className, id, children, ...rest }: Extra & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} error={error} id={id} className={fieldClassName}>
      {(c) => (
        <select className={cx('ui-input ui-select', className)} {...c} {...rest}>
          {children}
        </select>
      )}
    </Field>
  );
}
