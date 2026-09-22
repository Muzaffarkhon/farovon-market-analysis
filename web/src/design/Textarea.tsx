import { useId, type TextareaHTMLAttributes } from 'react';
import s from './Field.module.css';

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: string };

export function Textarea({ label, error, hint, id, className, ...rest }: Props) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className={[s.field, className].filter(Boolean).join(' ')}>
      <label className={s.label} htmlFor={inputId}>{label}</label>
      <textarea id={inputId} className={[s.control, error ? s.invalid : ''].join(' ')} aria-invalid={error ? true : undefined} {...rest} />
      {error ? <div className={s.error}>{error}</div> : hint ? <div className={s.hint}>{hint}</div> : null}
    </div>
  );
}
