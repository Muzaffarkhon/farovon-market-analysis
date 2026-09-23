import { useId, useRef } from 'react';
import s from './Field.module.css';

/** Обёртка над `<input type=file>` — читает выбранный файл как текст, без drag-n-drop. */
export function FileInput({ label, accept, hint, onSelect }: {
  label: string; accept?: string; hint?: string; onSelect: (text: string, file: File) => void;
}) {
  const auto = useId();
  const ref = useRef<HTMLInputElement>(null);

  const handleChange = async () => {
    const file = ref.current?.files?.[0];
    if (!file) return;
    const text = await file.text();
    onSelect(text, file);
  };

  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={auto}>{label}</label>
      <input id={auto} ref={ref} type="file" accept={accept} className={s.control} onChange={handleChange} />
      {hint && <div className={s.hint}>{hint}</div>}
    </div>
  );
}
