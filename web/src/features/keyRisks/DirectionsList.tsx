import { NavLink } from 'react-router';
import type { HeatmapRow } from '../../api/contract';
import s from './KeyRisks.module.css';

/** Карточки направлений — как индустриальные блоки в грейдировании: клик уводит к списку оценённых сотрудников направления. */
export function DirectionsList({ rows }: { rows: HeatmapRow[] }) {
  return (
    <div className={s.grid}>
      {rows.map(r => (
        <NavLink key={r.dir} to={`/key-risks/${encodeURIComponent(r.dir)}`} className={s.dirCard}>
          <div className={s.dirTitle}>{r.dir}</div>
          <div className={s.dirStats}>
            <span>{r.total} оценено</span>
            {r.critical > 0 && <span className={s.critical}> · {r.critical} критич.</span>}
            {r.attention > 0 && <span className={s.cellWarn}> · {r.attention} внимание</span>}
          </div>
        </NavLink>
      ))}
      {!rows.length && <p className={s.empty}>Пока ничего не оценено.</p>}
    </div>
  );
}
