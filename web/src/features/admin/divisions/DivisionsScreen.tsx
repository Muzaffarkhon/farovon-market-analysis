import { useMemo, useState } from 'react';
import type { Division } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { useConfirm } from '../../../design/Confirm';
import { Input } from '../../../design/Input';
import { Skeleton } from '../../../design/Skeleton';
import { SortTh } from '../../../design/SortTh';
import { ActiveTableFilterChips, TableFiltersButton } from '../../../design/TableFilters';
import { useSort } from '../../../design/useSort';
import type { TableFilterField } from '../../../design/useTableFilters';
import { useTableFilters } from '../../../design/useTableFilters';
import { useSessionData } from '../../auth/useSession';
import { useScreenTitle } from '../../shell/Shell';
import s from '../Admin.module.css';
import { AdjacentGroupsModal } from './AdjacentGroupsModal';
import { BatchAssignForm } from './BatchAssignForm';
import { CreateDivisionForm } from './CreateDivisionForm';
import { DivisionForm } from './DivisionForm';
import { MoveForm } from './MoveForm';
import { useDivisions } from './useDivisions';

export function DivisionsScreen() {
  useScreenTitle('Оргструктура');
  const { user } = useSessionData();
  const isAdmin = user.role === 'admin' || user.role === 'cb';
  const d = useDivisions();
  const confirm = useConfirm();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Division | null>(null);
  const [moving, setMoving] = useState<Division | null>(null);
  const [creating, setCreating] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);

  const groupCounts = useMemo(() => {
    const map = new Map<string, number>();
    (d.divisions ?? []).forEach(row => {
      const key = String(row.group_key || '').trim();
      if (key) map.set(key, (map.get(key) ?? 0) + 1);
    });
    return map;
  }, [d.divisions]);

  const dirOptions = useMemo(() => [...new Set((d.divisions ?? []).map(r => r.dir).filter(Boolean))] as string[], [d.divisions]);

  const filterFields: TableFilterField<Division>[] = useMemo(() => [
    { key: 'dir', label: 'Направление', get: r => r.dir ?? '', kind: 'select', options: dirOptions },
    { key: 'head', label: 'Руководитель', get: r => r.head },
    { key: 'resp', label: 'Ответственный', get: r => r.resp },
    { key: 'hrbp', label: 'HRBP', get: r => r.hrbp },
    { key: 'target', label: 'Цель сбора', get: r => r.is_survey_target ? 'да' : 'нет', kind: 'select' },
    { key: 'hidden', label: 'Скрыто', get: r => r.is_hidden ? 'да' : 'нет', kind: 'select' }
  ], [dirOptions]);

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = d.divisions ?? [];
    if (!q) return rows;
    return rows.filter(r => r.unit.toLowerCase().includes(q));
  }, [d.divisions, query]);

  const tf = useTableFilters(searched, filterFields);

  const { sorted, sortKey, sortDir, sortBy } = useSort(tf.filtered, (row, key) => {
    switch (key) {
      case 'unit': return row.unit;
      case 'dir': return row.dir;
      case 'head': return row.head;
      case 'resp': return row.resp;
      case 'hrbp': return row.hrbp;
      case 'target': return row.is_survey_target ? 1 : 0;
      case 'hidden': return row.is_hidden ? 1 : 0;
      default: return '';
    }
  });

  if (d.divisionsError) return <p className={s.empty}>{d.divisionsError.message}</p>;
  if (d.divisionsLoading) return <Skeleton lines={8} />;

  return (
    <div className={s.screenFill} data-wide>
      <div className={s.head}>
        <Input label="Поиск" placeholder="По названию" value={query} onChange={e => setQuery(e.target.value)} />
        <TableFiltersButton f={tf} fields={filterFields} />
        <div style={{ display: 'flex', gap: 8 }}>
          {isAdmin && <Button size="sm" variant="secondary" onClick={() => setGroupsOpen(true)}>Смежные группы{groupCounts.size ? ` (${groupCounts.size})` : ''}</Button>}
          {isAdmin && <Button size="sm" variant="secondary" onClick={() => setBatchOpen(true)}>Массовое назначение</Button>}
          {isAdmin && <Button size="sm" onClick={() => setCreating(true)}>Создать</Button>}
        </div>
      </div>

      <ActiveTableFilterChips f={tf} />
      <p className={s.hint}>
        {tf.filtered.length === (d.divisions ?? []).length ? `${tf.filtered.length} записей` : `${tf.filtered.length} из ${(d.divisions ?? []).length} записей`}
      </p>

      <div className={[s.tableWrapFill, s.hideOnMobile].join(' ')}>
        <table className={s.table}>
          <thead>
            <tr>
              <SortTh label="Подразделение" sortKey="unit" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <SortTh label="Направление" sortKey="dir" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <SortTh label="Руководитель" sortKey="head" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <SortTh label="Ответственный" sortKey="resp" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <SortTh label="HRBP" sortKey="hrbp" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <SortTh label="Цель сбора" sortKey="target" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <SortTh label="Скрыто" sortKey="hidden" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.id} className={s.clickableRow} onClick={() => setEditing(row)}>
                <td>
                  {row.unit}
                  {row.group_key && (groupCounts.get(row.group_key) ?? 0) > 1 && (
                    <span className={s.hint}> · Смежная · {groupCounts.get(row.group_key)} площ.</span>
                  )}
                </td>
                <td>{row.dir}</td>
                <td className={s.wrapCell}>{row.head}</td>
                <td className={s.wrapCell}>{row.resp}</td>
                <td className={s.wrapCell}>{row.hrbp}</td>
                <td>{row.is_survey_target ? 'да' : ''}</td>
                <td>{row.is_hidden ? 'да' : ''}</td>
                <td style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                  <Button size="sm" variant="secondary" onClick={() => setMoving(row)}>Переместить</Button>
                  {isAdmin && (
                    <Button size="sm" variant="secondary" onClick={() => d.setHidden({ unit: row.unit, hidden: !row.is_hidden })}>
                      {row.is_hidden ? 'Показать' : 'Скрыть'}
                    </Button>
                  )}
                  {isAdmin && (
                    <Button
                      size="sm" variant="danger"
                      onClick={async () => { if (await confirm({ message: `Удалить подразделение «${row.unit}»?`, danger: true })) d.remove(row.unit); }}
                    >
                      Удалить
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {!sorted.length && <tr><td colSpan={8} className={s.empty}>Подразделения не найдены</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Узкий экран: названия подразделений/направлений длинные — 3 колонки
          не влезали (см. заметку выше про 56px), оставлены 2, «Направление»
          подписью под названием. «Переместить»/«Скрыть-Показать»/«Удалить»
          переехали в форму (DivisionForm, .mobileFormActions). */}
      <div className={s.tableWrapFill}>
        <table className={s.tableCompact}>
          <thead><tr><th>Подразделение</th><th>Руководитель</th></tr></thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.id} className={s.clickableRow} onClick={() => setEditing(row)}>
                <td>{row.unit}<div className={s.hint}>{row.dir}</div></td>
                <td>{row.head}</td>
              </tr>
            ))}
            {!sorted.length && <tr><td colSpan={2} className={s.empty}>Подразделения не найдены</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <DivisionForm
          division={editing}
          suggestions={d.groupSuggestions}
          onClose={() => setEditing(null)}
          onSubmit={p => { d.save(p); setEditing(null); }}
          onApplyGroup={p => d.applyAdjacentGroup(p)}
          onMove={() => { setEditing(null); setMoving(editing); }}
          onToggleHidden={() => { d.setHidden({ unit: editing.unit, hidden: !editing.is_hidden }); setEditing(null); }}
          onDelete={isAdmin ? async () => {
            if (await confirm({ message: `Удалить подразделение «${editing.unit}»?`, danger: true })) { d.remove(editing.unit); setEditing(null); }
          } : undefined}
        />
      )}

      {groupsOpen && (
        <AdjacentGroupsModal
          divisions={d.divisions ?? []}
          applying={d.applyingAdjacentGroup}
          onClose={() => setGroupsOpen(false)}
          onApply={p => d.applyAdjacentGroup({ ...p, force: true })}
          onClear={p => d.clearAdjacentGroup(p)}
        />
      )}

      {moving && (
        <MoveForm
          division={moving}
          onClose={() => setMoving(null)}
          onSubmit={p => { d.move(p); setMoving(null); }}
        />
      )}

      {creating && (
        <CreateDivisionForm
          dirOptions={dirOptions}
          submitting={d.creating}
          onClose={() => setCreating(false)}
          onSubmit={p => { d.create(p); setCreating(false); }}
        />
      )}

      {batchOpen && (
        <BatchAssignForm
          dirOptions={dirOptions}
          submitting={d.batchAssigning}
          onClose={() => setBatchOpen(false)}
          onSubmit={p => { d.batchAssign(p); setBatchOpen(false); }}
        />
      )}
    </div>
  );
}
