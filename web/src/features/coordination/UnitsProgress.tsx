import type { CoordinationUnit } from '../../api/contract';
import { RankBar } from '../../design/RankBar';
import { shortDate } from '../registry/format';
import s from './Coordination.module.css';

/** Прогресс по подразделениям — сначала отстающие (нулевые и наименьшая доля решённого). */
export function UnitsProgress({ units }: { units: CoordinationUnit[] }) {
  const withPct = units.map(u => ({ ...u, pct: u.positionsTotal > 0 ? u.positionsDecided / u.positionsTotal : Infinity }));
  const sorted = [...withPct].sort((a, b) => a.pct - b.pct);

  return (
    <div className={s.column}>
      <h3 className={s.sectionTitle}>Подразделения</h3>
      {sorted.map(u => (
        <div key={u.unit} className={s.unitRow}>
          <RankBar
            label={u.unit}
            pct={u.positionsTotal > 0 ? Math.round((u.positionsDecided / u.positionsTotal) * 100) : 0}
            count={u.positionsTotal ? u.positionsDecided : undefined}
          />
          <div className={s.unitMeta}>
            {u.state}{u.lastActivityAt ? ` · последняя запись ${shortDate(u.lastActivityAt)}` : ''}
          </div>
        </div>
      ))}
      {!sorted.length && <p className={s.empty}>Подразделений не найдено.</p>}
    </div>
  );
}
