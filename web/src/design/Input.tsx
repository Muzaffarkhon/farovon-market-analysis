import { useId, type InputHTMLAttributes } from 'react';
import s from './Field.module.css';

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string };

export function Input({ label, error, hint, id, className, ...rest }: Props) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className={[s.field, className].filter(Boolean).join(' ')}>
      <label className={s.label} htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        className={[s.control, error ? s.invalid : ''].join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? inputId + '-err' : undefined}
        {...rest}
      />
      {error ? <div id={inputId + '-err'} className={s.error}>{error}</div> : hint ? <div className={s.hint}>{hint}</div> : null}
    </div>
  );
}
