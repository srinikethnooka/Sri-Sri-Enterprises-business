import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';

interface FieldShell {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  className?: string;
}

function Shell({ id, label, hint, error, className, children, required }: FieldShell & { id: string; children: ReactNode; required?: boolean }) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="label">
          {label}
          {required && <span className="text-burgundy-700"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-sm text-burgundy-700" role="alert">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

export const TextField = forwardRef<HTMLInputElement, FieldShell & InputHTMLAttributes<HTMLInputElement>>(
  function TextField({ label, hint, error, className, id, ...rest }, ref) {
    const auto = useId();
    const fid = id ?? auto;
    return (
      <Shell id={fid} label={label} hint={hint} error={error} className={className} required={rest.required}>
        <input
          ref={ref}
          id={fid}
          className={clsx('input', error && 'input-error')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fid}-err` : hint ? `${fid}-hint` : undefined}
          {...rest}
        />
      </Shell>
    );
  },
);

export const SelectField = forwardRef<HTMLSelectElement, FieldShell & SelectHTMLAttributes<HTMLSelectElement>>(
  function SelectField({ label, hint, error, className, id, children, ...rest }, ref) {
    const auto = useId();
    const fid = id ?? auto;
    return (
      <Shell id={fid} label={label} hint={hint} error={error} className={className} required={rest.required}>
        <select ref={ref} id={fid} className={clsx('input pr-8', error && 'input-error')} aria-invalid={error ? true : undefined} {...rest}>
          {children}
        </select>
      </Shell>
    );
  },
);

export const TextAreaField = forwardRef<HTMLTextAreaElement, FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextAreaField({ label, hint, error, className, id, rows = 3, ...rest }, ref) {
    const auto = useId();
    const fid = id ?? auto;
    return (
      <Shell id={fid} label={label} hint={hint} error={error} className={className} required={rest.required}>
        <textarea ref={ref} id={fid} rows={rows} className={clsx('input', error && 'input-error')} aria-invalid={error ? true : undefined} {...rest} />
      </Shell>
    );
  },
);

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }>(
  function Checkbox({ label, hint, ...rest }, ref) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input ref={ref} id={id} type="checkbox" className="mt-0.5 h-5 w-5 rounded border-cream-300 text-burgundy-700 focus:ring-burgundy-400" {...rest} />
      <label htmlFor={id} className="text-sm text-ink-700">
        {label}
        {hint && <span className="block text-xs text-ink-500">{hint}</span>}
      </label>
    </div>
  );
});
