import { useState } from 'react';
import type { DashboardResponse, PositionStat } from '../../api/contract';
import { Chip } from '../../design/Chip';
import { ForkBar } from '../../design/ForkBar';
import { PositionSheet } from './PositionSheet';
import s from './Dashboard.module.css';

const SORTS = [
  { key: 'count', label: 'По числу наблюдений', by: (p: PositionStat) => -p.count },
  { key: 'median', label: 'По медиане', by: (p: PositionStat) => -p.median },
  { key: 'gap', label: 'По гэпу к рынку', by: (p: PositionStat) => (p.gapPct == null ? 1 : -Math.abs(p.gapPct)) }
] as const;

/**
 * Все должности рынка строками вилки. Поиск по названию — общее поле фильтров
 * дашборда (сервер уже отбирает по нему `positions`, второй раз здесь не
 * фильтруем). Клик на строку — шторка с компаниями, давшими данные.
 */
export function SalariesTab({ data }: { data: DashboardResponse }) {
  const [sort, setSort] = useState<(typeof SORTS)[number]['key']>('count');
  const [open, setOpen] = useState<PositionStat | null>(null);

  const sorted = [...data.positions].sort((a, b) => {
    const f = SORTS.find(s2 => s2.key === sort)!.by;
    return f(a) - f(b);
  });
  const domainMax = Math.max(1, ...data.positions.map(p => p.max));

  return (
    <div>
      <div className={s.sortRow}>
        {SORTS.map(o => (
          <Chip key={o.key} active={sort === o.key} onClick={() => setSort(o.key)}>{o.label}</Chip>
        ))}
      </div>
      {sorted.map(p => (
        <button key={p.pos} type="button" className={s.forkRowBtn} onClick={() => setOpen(p)}>
          <ForkBar
            label={p.pos} stats={p} domainMax={domainMax}
            rightValue={`${p.median.toLocaleString('ru-RU')}${p.gapPct != null ? ` · ${p.gapPct > 0 ? '+' : ''}${p.gapPct}%` : ''}`}
          />
        </button>
      ))}
      {!sorted.length && <p className={s.empty}>По выбранным фильтрам должностей не найдено.</p>}
      <PositionSheet position={open} onClose={() => setOpen(null)} />
    </div>
  );
}
