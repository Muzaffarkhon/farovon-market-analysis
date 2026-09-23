import { useState } from 'react';
import { Button } from './Button';
import s from './ColumnPicker.module.css';

export type ColumnOption = { key: string; title: string };

type Props = {
  columns: ColumnOption[];
  visible: Set<string>;
  onToggle: (key: string) => void;
};

/** Кнопка «Колонки» с чек-листом видимости — сохранение делает вызывающий (useTablePrefs). */
export function ColumnPicker({ columns, visible, onToggle }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className={s.wrap}>
      <Button variant="secondary" size="sm" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label="Колонки" title="Колонки">
        ⚙
      </Button>
      {open && (
        <div className={s.menu} role="menu" onMouseLeave={() => setOpen(false)}>
          {columns.map(c => (
            <label key={c.key} className={s.item}>
              <input
                type="checkbox" checked={visible.has(c.key)}
                disabled={visible.has(c.key) && visible.size === 1}
                onChange={() => onToggle(c.key)}
              />
              <span>{c.title}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
