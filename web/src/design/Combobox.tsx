import { useEffect, useId, useMemo, useRef, useState } from 'react';
import fs from './Field.module.css';
import s from './Combobox.module.css';

export type ComboOption = { value: string; label: string };

type Props = {
  label: string;
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  id?: string;
  /** Список ещё грузится — показать «Загрузка…» вместо обманчивого «Ничего не найдено». */
  loading?: boolean;
};

/**
 * Выпадающий список с поиском по подписи — замена <select> там, где
 * справочник длинный (подразделения, должности, компании: сотни строк,
 * обычный select с type-ahead по первой букве неудобен). API близок к
 * Select: value/onChange те же ключи, но onChange отдаёт готовую строку,
 * не событие — реального change-события у текстового поля со списком нет.
 */
export function Combobox({ label, options, value, onChange, placeholder, error, hint, disabled, id, loading }: Props) {
  const auto = useId();
  const inputId = id ?? auto;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find(o => o.value === value);

  useEffect(() => { if (!open) setQuery(''); }, [open]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, query]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  return (
    <div className={[fs.field, s.wrap].join(' ')} ref={rootRef}>
      <label className={fs.label} htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        role="combobox" aria-expanded={open} aria-autocomplete="list" autoComplete="off"
        className={[fs.control, error ? fs.invalid : ''].join(' ')}
        disabled={disabled}
        placeholder={placeholder}
        value={open ? query : (selected?.label ?? '')}
        onFocus={() => setOpen(true)}
        onChange={e => {
          setQuery(e.target.value);
          setOpen(true);
          if (value && e.target.value === '') onChange('');
        }}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
      />
      {!!value && !disabled && (
        <button type="button" className={s.clearBtn} aria-label="Очистить" onClick={() => { onChange(''); setQuery(''); }}>×</button>
      )}
      {open && !disabled && (
        <ul className={s.list} role="listbox">
          {loading && <li className={s.empty}>Загрузка…</li>}
          {!loading && !filtered.length && <li className={s.empty}>Ничего не найдено</li>}
          {filtered.slice(0, 200).map(o => (
            <li
              key={o.value} role="option" aria-selected={o.value === value}
              className={[s.option, o.value === value ? s.selected : ''].join(' ')}
              onClick={() => pick(o.value)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
      {error ? <div className={fs.error}>{error}</div> : hint ? <div className={fs.hint}>{hint}</div> : null}
    </div>
  );
}
