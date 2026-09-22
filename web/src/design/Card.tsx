import type { ReactNode } from 'react';
import s from './Card.module.css';

export function Card({ onClick, arrow, children }: { onClick?: () => void; arrow?: boolean; children: ReactNode }) {
  if (onClick) {
    return (
      <button type="button" className={[s.card, s.clickable].join(' ')} onClick={onClick}>
        <div className={s.body}>{children}</div>
        {arrow && <span className={s.arrow} aria-hidden>›</span>}
      </button>
    );
  }
  return <div className={s.card}><div className={s.body}>{children}</div></div>;
}
