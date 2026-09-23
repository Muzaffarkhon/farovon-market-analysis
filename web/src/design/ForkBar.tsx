import type { ReactNode } from 'react';
import type { ForkStats } from '../api/contract';
import { forkLayout } from '../domain/dashboard';
import s from './ForkBar.module.css';

/**
 * Горизонтальная шкала вилки: тонкая линия min–max, закрашенный блок
 * P25–P75, риска медианы. `domainMax` — общий для всех строк списка/таблицы,
 * чтобы вилки разных должностей/регионов были сравнимы на глаз (см.
 * `domain/dashboard.ts`). Вырожденный случай (min===max) рисуется точкой.
 */
export function ForkBar({ label, stats, domainMax, rightValue }: {
  label: ReactNode;
  stats: ForkStats;
  domainMax: number;
  rightValue?: ReactNode;
}) {
  const l = forkLayout(stats, domainMax);
  return (
    <div className={s.row}>
      <div className={s.label}>{label}</div>
      <div className={s.track}>
        {l.degenerate ? (
          <div className={s.point} style={{ left: `${l.medianLeft}%` }} />
        ) : (
          <>
            <div className={s.line} style={{ left: `${l.lineLeft}%`, width: `${l.lineWidth}%` }} />
            <div className={s.box} style={{ left: `${l.boxLeft}%`, width: `${l.boxWidth}%` }} />
            <div className={s.median} style={{ left: `${l.medianLeft}%` }} />
          </>
        )}
      </div>
      {rightValue !== undefined && <div className={s.right}>{rightValue}</div>}
    </div>
  );
}
