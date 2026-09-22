import type { KeyboardEvent, ReactNode } from 'react';
import s from './Survey.module.css';

export function FormBlock({ title, open, filled, hasError, onToggle, onKeyDown, innerRef, children }: {
  title: string;
  open: boolean;
  filled: boolean;
  hasError?: boolean;
  onToggle: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  innerRef?: (el: HTMLElement | null) => void;
  children: ReactNode;
}) {
  return (
    <section className={[s.block, hasError ? s.blockError : ''].join(' ')} ref={innerRef}>
      <button type="button" className={s.blockHead} aria-expanded={open} onClick={onToggle}>
        <span>{title}</span>
        <span>
          {hasError
            ? <span className={s.warn} aria-label="есть ошибка">!</span>
            : filled && <span className={s.tick} aria-label="заполнено">✓</span>}
          {' '}{open ? '▴' : '▾'}
        </span>
      </button>
      {open && <div className={s.blockBody} onKeyDown={onKeyDown}>{children}</div>}
    </section>
  );
}
