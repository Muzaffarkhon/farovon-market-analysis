import { useMemo, useState } from 'react';
import type { Division } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { useConfirm } from '../../../design/Confirm';
import { Input } from '../../../design/Input';
import { Sheet } from '../../../design/Sheet';
import s from '../Admin.module.css';

/**
 * Инструмент из старого клиента (client/app.js, openAdjacentGroupsModal):
 * разные площадки одной сети («Фаровон — Анхор», «Фаровон — Душанбе») можно
 * свести в одну карточку «Смежная группа» для сравнения зарплат — только
 * группировка, сами подразделения и их данные не меняются, кроме поля
 * group_key. Разъединение обратимо (снимает ключ), объединение — нет
 * (перезаписывает уже проставленный ручной ключ у выбранных площадок).
 */
export function AdjacentGroupsModal({ divisions, onClose, onApply, onClear, applying }: {
  divisions: Division[];
  onClose: () => void;
  onApply: (p: { key: string; units: string[] }) => void;
  onClear: (p: { key: string }) => void;
  applying: boolean;
}) {
  const confirm = useConfirm();
  const [query, setQuery] = useState('');
  const [newKey, setNewKey] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const map = new Map<string, Division[]>();
    divisions.forEach(d => {
      const key = String(d.group_key || '').trim();
      if (!key) return;
      const arr = map.get(key) || [];
      arr.push(d);
      map.set(key, arr);
    });
    return Array.from(map.entries())
      .map(([key, units]) => ({ key, dir: units[0]?.dir ?? '', units }))
      .sort((a, b) => a.key.localeCompare(b.key, 'ru'));
  }, [divisions]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q ? divisions.filter(d => d.unit.toLowerCase().includes(q)) : divisions;
    return rows.slice().sort((a, b) => a.unit.localeCompare(b.unit, 'ru'));
  }, [divisions, query]);

  function toggle(unit: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(unit)) next.delete(unit); else next.add(unit);
      return next;
    });
  }

  async function doClear(key: string, count: number) {
    const ok = await confirm({
      title: 'Разъединить группу',
      message: `Группа «${key}» (${count} площадок) будет разъединена — карточки снова станут отдельными подразделениями.`,
      okLabel: 'Разъединить', danger: true
    });
    if (ok) onClear({ key });
  }

  function doCreate() {
    const key = newKey.trim();
    if (!key || selected.size < 2) return;
    onApply({ key, units: Array.from(selected) });
    setNewKey('');
    setSelected(new Set());
  }

  return (
    <Sheet open onClose={onClose} title="Смежные группы подразделений" variant="modal">
      <div className={s.form}>
        <p className={s.hint}>
          Смежная группа объединяет разные площадки одной сети в одну карточку для сравнения зарплат.
          Данные самих подразделений не меняются — только группировка.
        </p>

        {groups.length > 0 && (
          <div className={s.tableWrap} style={{ maxHeight: 240 }}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Группа</th>
                  <th>Направление</th>
                  <th>Площадки</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.key}>
                    <td><b>{g.key}</b></td>
                    <td>{g.dir}</td>
                    <td className={s.wrapCell}>{g.units.map(u => u.unit).join(', ')}</td>
                    <td>
                      <Button size="sm" variant="danger" onClick={() => doClear(g.key, g.units.length)}>Разъединить</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!groups.length && <p className={s.hint}>Смежных групп пока нет.</p>}

        <hr />
        <p className={s.hint}><b>Создать новую группу</b></p>
        <Input label="Название группы" placeholder="Например, «Фаровон»" value={newKey} onChange={e => setNewKey(e.target.value)} />
        <Input label="Поиск подразделений" value={query} onChange={e => setQuery(e.target.value)} />
        <div className={s.tableWrap} style={{ maxHeight: 240 }}>
          <table className={s.table}>
            <thead>
              <tr>
                <th></th>
                <th>Подразделение</th>
                <th>Направление</th>
                <th>Текущая группа</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map(d => (
                <tr key={d.id}>
                  <td><input type="checkbox" checked={selected.has(d.unit)} onChange={() => toggle(d.unit)} aria-label={`Выбрать «${d.unit}»`} /></td>
                  <td className={s.wrapCell}>{d.unit}</td>
                  <td>{d.dir}</td>
                  <td>{d.group_key || '—'}</td>
                </tr>
              ))}
              {!candidates.length && <tr><td colSpan={4} className={s.empty}>Ничего не найдено</td></tr>}
            </tbody>
          </table>
        </div>

        <div className={s.formFoot}>
          <Button loading={applying} disabled={!newKey.trim() || selected.size < 2} onClick={doCreate}>
            Создать группу{selected.size >= 2 ? ` (${selected.size})` : ''}
          </Button>
        </div>
        {selected.size === 1 && <p className={s.hint}>Отметьте ещё хотя бы одну площадку.</p>}
      </div>
    </Sheet>
  );
}
