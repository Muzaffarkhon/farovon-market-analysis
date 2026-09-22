import type { ReactNode } from 'react';
import s from './Survey.module.css';

export function FormBlock({ title, open, filled, onToggle, children }: {
  title: string;
  open: boolean;
  filled: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={s.block}>
      <button type="button" className={s.blockHead} aria-expanded={open} onClick={onToggle}>
        <span>{title}</span>
        <span>{filled && <span className={s.tick} aria-label="заполнено">✓</span>} {open ? '▴' : '▾'}</span>
      </button>
      {open && <div className={s.blockBody}>{children}</div>}
    </section>
  );
}
