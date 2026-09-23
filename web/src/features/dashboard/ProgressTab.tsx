import type { DashboardResponse } from '../../api/contract';
import { RankBar } from '../../design/RankBar';
import s from './Dashboard.module.css';

/**
 * Прогресс сбора по HR BP и по направлениям — только чтение. Переназначение
 * ответственных, напоминания и персональные списки дел — «Координация для
 * HR BP», отдельный раздел (этап 4), не эта вкладка.
 */
export function ProgressTab({ data }: { data: DashboardResponse }) {
  return (
    <div className={s.overviewBody}>
      <ProgressList title="По HR BP" rows={data.hrbpProgress} name={r => r.hrbp} />
      <ProgressList title="По направлениям" rows={data.dirProgress} name={r => r.dir} />
    </div>
  );
}

function ProgressList<T extends { pct: number; compTotal: number; compDone: number }>({ title, rows, name }: {
  title: string; rows: T[]; name: (r: T) => string;
}) {
  return (
    <div className={s.overviewMain}>
      <h3 className={s.sectionTitle}>{title}</h3>
      {rows.map(r => (
        <RankBar key={name(r)} label={name(r)} pct={r.pct} count={r.compTotal ? r.compDone : undefined} />
      ))}
      {!rows.length && <p className={s.empty}>Подразделений не найдено.</p>}
    </div>
  );
}
