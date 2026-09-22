import { useId, type SelectHTMLAttributes } from 'react';
import s from './Field.module.css';

export type Option = { value: string; label: string };
type Props = SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: Option[]; error?: string; hint?: string; placeholder?: string };

export function Select({ label, options, error, hint, placeholder, id, className, ...rest }: Props) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className={[s.field, className].filter(Boolean).join(' ')}>
      <label className={s.label} htmlFor={inputId}>{label}</label>
      <select id={inputId} className={[s.control, error ? s.invalid : ''].join(' ')} aria-invalid={error ? true : undefined} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error ? <div className={s.error}>{error}</div> : hint ? <div className={s.hint}>{hint}</div> : null}
    </div>
  );
}
