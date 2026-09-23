import type { ReactNode } from 'react';
import s from './KpiTile.module.css';

/**
 * Плитка KPI: число крупно, подпись мелко под ним, единица измерения — рядом
 * с числом, а не отдельной строкой (ТЗ, раздел 10). Не больше четырёх в ряд —
 * это задаёт вызывающий экран сеткой, не сам компонент.
 */
export function KpiTile({ label, value, unit, hint, tone }: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: string;
  tone?: 'ok' | 'warn';
}) {
  return (
    <div className={s.tile} title={hint}>
      <div className={s.label}>{label}</div>
      <div className={[s.value, tone ? s[tone] : ''].join(' ')}>
        {value}
        {unit && <span className={s.unit}>{unit}</span>}
      </div>
    </div>
  );
}
