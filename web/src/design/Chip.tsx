import type { ReactNode } from 'react';
import s from './Chip.module.css';

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" className={[s.chip, active ? s.active : ''].join(' ')} aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  );
}
