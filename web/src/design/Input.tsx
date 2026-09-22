import { useId, type InputHTMLAttributes } from 'react';
import s from './Field.module.css';

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string; invalid?: boolean };

export function Input({ label, error, hint, invalid, id, className, ...rest }: Props) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className={[s.field, className].filter(Boolean).join(' ')}>
      <label className={s.label} htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        className={[s.control, error || invalid ? s.invalid : ''].join(' ')}
        aria-invalid={error || invalid ? true : undefined}
        aria-describedby={error ? inputId + '-err' : undefined}
        {...rest}
      />
      {error ? <div id={inputId + '-err'} className={s.error}>{error}</div> : hint ? <div className={s.hint}>{hint}</div> : null}
    </div>
  );
}
