import { useMemo, useState } from 'react';
import { Button } from '../../../design/Button';
import { useConfirm } from '../../../design/Confirm';
import { Input } from '../../../design/Input';
import { Select } from '../../../design/Select';
import { Sheet } from '../../../design/Sheet';
import { Skeleton } from '../../../design/Skeleton';
import s from '../Admin.module.css';
import { useMerge, type MergeKind } from './useMerge';

/**
 * Инструмент из старого клиента (client/app.js, openMergeCompaniesModal /
 * openMergePositionsModal): несколько написаний одной компании/должности
 * («Амид» / «Амид групп») сводятся к одному. Слияние необратимо и
 * перезаписывает данные во всех связанных таблицах на сервере — сама модалка
 * ничего не решает, только выбор «кого во что» и подтверждение.
 */
export function MergeDuplicates({ kind, onClose }: { kind: MergeKind; onClose: () => void }) {
  const m = useMerge(kind);
  const confirm = useConfirm();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keep, setKeep] = useState<string>('');

  const title = kind === 'companies' ? 'Объединение дублей — компании' : 'Объединение дублей — должности';
  const one = kind === 'companies' ? 'компанию' : 'должность';

  // «Похоже: X, Y» под именем — подсказка из find_similar_names, не меняет
  // данные сама по себе, только помогает найти кандидатов на объединение.
  const similarByName = useMemo(() => {
    const map = new Map<string, string[]>();
    const push = (a: string, b: string) => { const arr = map.get(a) || []; if (!arr.includes(b)) arr.push(b); map.set(a, arr); };
    m.pairs.forEach(p => { push(p.a, p.b); push(p.b, p.a); });
    return map;
  }, [m.pairs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q ? m.rows.filter(r => r.name.toLowerCase().includes(q)) : m.rows;
    return rows.slice().sort((a, b) => b.used - a.used || a.name.localeCompare(b.name, 'ru'));
  }, [m.rows, query]);

  function toggle(name: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      if (!next.has(keep)) setKeep(next.size ? Array.from(next).sort((a, b) => (byName(b)?.used ?? 0) - (byName(a)?.used ?? 0))[0] : '');
      return next;
    });
  }

  function byName(name: string) { return m.rows.find(r => r.name === name); }

  function pickPair(a: string, b: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.add(a); next.add(b);
      return next;
    });
    setKeep(prev => prev || (byName(a) && byName(b) ? ((byName(a)!.used >= byName(b)!.used) ? a : b) : a));
  }

  async function doMerge() {
    const list = Array.from(selected).filter(n => n !== keep);
    if (!keep || !list.length) return;
    const ok = await confirm({
      title: `Объединить ${list.length + 1} → 1`,
      message: `«${list.join('», «')}» станет «${keep}». Действие необратимо: все связанные строки (анкеты, участники рынка` +
        (kind === 'positions' ? ', штатное расписание, выбор компаний по должностям' : ', выбор компаний по должностям') +
        `) будут переписаны на «${keep}».`,
      okLabel: 'Объединить', danger: true
    });
    if (!ok) return;
    m.merge({ keep, merge: list }, {
      onSuccess: () => { setSelected(new Set()); setKeep(''); }
    });
  }

  return (
    <Sheet open onClose={onClose} title={title} variant="modal">
      {m.loading ? <Skeleton lines={6} /> : m.error ? <p className={s.empty}>{m.error.message}</p> : (
        <div className={s.form}>
          <p className={s.hint}>
            {kind === 'positions'
              ? 'Грейдинг, риски незаменимости и справочник сотрудников 1С этот инструмент не трогает — это отдельные модули со своим понятием «должность».'
              : 'Отметьте варианты написания одной и той же компании и выберите, какое название оставить основным.'}
          </p>
          <Input label="Поиск по названию" value={query} onChange={e => setQuery(e.target.value)} />

          <div className={s.tableWrap} style={{ maxHeight: 360 }}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th></th>
                  <th>Название</th>
                  <th>Использований</th>
                  <th>В справочнике</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.name}>
                    <td><input type="checkbox" checked={selected.has(r.name)} onChange={() => toggle(r.name)} aria-label={`Выбрать «${r.name}»`} /></td>
                    <td className={s.wrapCell}>
                      <b>{r.name}</b>
                      {r.parts.length > 0 && <div className={s.hint}>{r.parts.join(', ')}</div>}
                      {(similarByName.get(r.name) || []).length > 0 && (
                        <div className={s.hint}>
                          похоже: {(similarByName.get(r.name) || []).map((other, i) => (
                            <span key={other}>
                              {i > 0 && ', '}
                              <button type="button" className={s.linkBtn} onClick={() => pickPair(r.name, other)}>{other}</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>{r.used}</td>
                    <td>{r.inDictionary ? 'да' : '—'}</td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan={4} className={s.empty}>Ничего не найдено</td></tr>}
              </tbody>
            </table>
          </div>

          {selected.size >= 2 && (
            <div className={s.formFoot} style={{ justifyContent: 'space-between' }}>
              <Select
                label="Сделать основным" value={keep} onChange={e => setKeep(e.target.value)}
                options={Array.from(selected).map(n => ({ value: n, label: n }))}
              />
              <Button variant="danger" loading={m.merging} onClick={doMerge}>Объединить {selected.size} → 1</Button>
            </div>
          )}
          {selected.size === 1 && <p className={s.hint}>Отметьте ещё хотя бы одну {one} для объединения.</p>}
        </div>
      )}
    </Sheet>
  );
}
