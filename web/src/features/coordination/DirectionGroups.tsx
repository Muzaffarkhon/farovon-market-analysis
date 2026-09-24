import { useState } from 'react';
import type { CoordinationPerson, CoordinationUnit } from '../../api/contract';
import { Badge } from '../../design/Badge';
import { RankBar } from '../../design/RankBar';
import { shortDate } from '../registry/format';
import { pctOf, sortByPct } from './dirGroups';
import s from './Coordination.module.css';

type UnitWithPct = CoordinationUnit & { pct: number };
type Group = { dir: string; units: UnitWithPct[]; people: CoordinationPerson[]; total: number; decided: number; pct: number };

/**
 * Направления с их подразделениями и ответственными людьми в одном
 * разворачиваемом списке. Раньше подразделения и люди были в двух разных
 * колонках, каждая со своей группировкой по направлению — заголовок
 * направления дублировался в обеих, и было не сразу понятно, что это
 * одно и то же направление. Один список на направление снимает дублирование.
 */
export function DirectionGroups({ units, people, selected, onToggle }: {
  units: CoordinationUnit[];
  people: CoordinationPerson[];
  selected: Set<string>;
  onToggle: (login: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const dirByUnit = new Map(units.map(u => [u.unit, u.dir || '—']));
  const byDir = new Map<string, { units: CoordinationUnit[]; people: CoordinationPerson[] }>();
  function bucket(dir: string) {
    let b = byDir.get(dir);
    if (!b) { b = { units: [], people: [] }; byDir.set(dir, b); }
    return b;
  }
  for (const u of units) bucket(u.dir || '—').units.push(u);
  for (const p of people) {
    const dirs = new Set(p.units.map(u => dirByUnit.get(u) || '—'));
    for (const dir of dirs) bucket(dir).people.push(p);
  }

  const groups: Group[] = sortByPct([...byDir.entries()].map(([dir, b]) => {
    const total = b.units.reduce((sum, u) => sum + u.positionsTotal, 0);
    const decided = b.units.reduce((sum, u) => sum + u.positionsDecided, 0);
    return {
      dir,
      units: sortByPct(b.units.map(u => ({ ...u, pct: pctOf(u.positionsTotal, u.positionsDecided) }))),
      people: b.people,
      total, decided,
      pct: pctOf(total, decided)
    };
  }));

  function toggle(dir: string) {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir); else next.add(dir);
      return next;
    });
  }

  return (
    <div className={s.column}>
      <h3 className={s.sectionTitle}>Направления</h3>
      {groups.map(g => {
        const expanded = open.has(g.dir);
        return (
          <div key={g.dir} className={s.dirGroup}>
            <button type="button" className={s.dirHead} onClick={() => toggle(g.dir)} aria-expanded={expanded}>
              <RankBar
                label={`${g.dir} · ${g.units.length}`}
                pct={g.total > 0 ? Math.round((g.decided / g.total) * 100) : 0}
                count={g.total ? g.decided : undefined}
                bold
              />
              <span className={[s.dirChevron, expanded ? s.dirChevronOpen : ''].join(' ')} aria-hidden="true">›</span>
            </button>
            {expanded && (
              <div className={s.dirBody}>
                <h4 className={s.subTitle}>Подразделения</h4>
                {g.units.map(u => (
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
                {!g.units.length && <p className={s.empty}>Подразделений не найдено.</p>}

                <h4 className={s.subTitle}>Люди</h4>
                {g.people.map(p => (
                  <label key={p.login} className={s.personRow}>
                    <input
                      type="checkbox" aria-label={p.fio}
                      checked={selected.has(p.login)}
                      onChange={() => onToggle(p.login)}
                    />
                    <span className={s.personMain}>
                      <b>{p.fio}</b>
                      <span className={s.personMeta}>
                        {p.positionsDecided} из {p.positionsTotal}
                        {p.lastLoginAt ? ` · заходил ${shortDate(p.lastLoginAt)}` : ' · ещё не заходил'}
                      </span>
                      {!p.hasTelegram && <span className={s.personBadge}><Badge tone="warn">нет Telegram</Badge></span>}
                    </span>
                  </label>
                ))}
                {!g.people.length && <p className={s.empty}>Людей не найдено.</p>}
              </div>
            )}
          </div>
        );
      })}
      {!groups.length && <p className={s.empty}>Подразделений не найдено.</p>}
    </div>
  );
}
