import { useState } from 'react';
import type { CoordinationUnit } from '../../api/contract';
import { RankBar } from '../../design/RankBar';
import { shortDate } from '../registry/format';
import s from './Coordination.module.css';

function pctOf(total: number, decided: number) {
  return total > 0 ? decided / total : Infinity;
}

function sortByPct<T extends { pct: number }>(list: T[]) {
  return [...list].sort((a, b) => a.pct - b.pct);
}

/**
 * Прогресс по подразделениям, сгруппированный по направлениям — список
 * длиннее экрана, когда подразделений много (сотни), сгруппированное
 * состояние по умолчанию проще просканировать. Направление разворачивается
 * по клику и показывает свои подразделения — тоже сначала отстающие.
 */
export function UnitsProgress({ units }: { units: CoordinationUnit[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const byDir = new Map<string, CoordinationUnit[]>();
  for (const u of units) {
    const key = u.dir || '—';
    (byDir.get(key) ?? byDir.set(key, []).get(key)!).push(u);
  }
  const groups = sortByPct(
    [...byDir.entries()].map(([dir, list]) => {
      const total = list.reduce((sum, u) => sum + u.positionsTotal, 0);
      const decided = list.reduce((sum, u) => sum + u.positionsDecided, 0);
      return { dir, list: sortByPct(list.map(u => ({ ...u, pct: pctOf(u.positionsTotal, u.positionsDecided) }))), total, decided, pct: pctOf(total, decided) };
    })
  );

  function toggle(dir: string) {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir); else next.add(dir);
      return next;
    });
  }

  return (
    <div className={s.column}>
      <h3 className={s.sectionTitle}>Подразделения</h3>
      {groups.map(g => {
        const expanded = open.has(g.dir);
        return (
          <div key={g.dir} className={s.dirGroup}>
            <button type="button" className={s.dirHead} onClick={() => toggle(g.dir)} aria-expanded={expanded}>
              <RankBar
                label={`${g.dir} · ${g.list.length}`}
                pct={g.total > 0 ? Math.round((g.decided / g.total) * 100) : 0}
                count={g.total ? g.decided : undefined}
                bold
              />
              <span className={[s.dirChevron, expanded ? s.dirChevronOpen : ''].join(' ')} aria-hidden="true">›</span>
            </button>
            {expanded && g.list.map(u => (
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
          </div>
        );
      })}
      {!groups.length && <p className={s.empty}>Подразделений не найдено.</p>}
    </div>
  );
}
