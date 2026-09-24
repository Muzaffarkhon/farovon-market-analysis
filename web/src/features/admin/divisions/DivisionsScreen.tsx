import { useMemo, useState } from 'react';
import type { Division } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { Input } from '../../../design/Input';
import { Skeleton } from '../../../design/Skeleton';
import { useSessionData } from '../../auth/useSession';
import { useScreenTitle } from '../../shell/Shell';
import s from '../Admin.module.css';
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
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Division | null>(null);
  const [moving, setMoving] = useState<Division | null>(null);
  const [creating, setCreating] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = d.divisions ?? [];
    if (!q) return rows;
    return rows.filter(r => r.unit.toLowerCase().includes(q) || (r.dir ?? '').toLowerCase().includes(q));
  }, [d.divisions, query]);

  const dirOptions = useMemo(() => [...new Set((d.divisions ?? []).map(r => r.dir).filter(Boolean))] as string[], [d.divisions]);

  if (d.divisionsError) return <p className={s.empty}>{d.divisionsError.message}</p>;
  if (d.divisionsLoading) return <Skeleton lines={8} />;

  return (
    <div className={s.screenFill} data-wide>
      <div className={s.head}>
        <Input label="Поиск" placeholder="По названию или направлению" value={query} onChange={e => setQuery(e.target.value)} />
        <div style={{ display: 'flex', gap: 8 }}>
          {isAdmin && <Button size="sm" variant="secondary" onClick={() => setBatchOpen(true)}>Массовое назначение</Button>}
          {isAdmin && <Button size="sm" onClick={() => setCreating(true)}>Создать</Button>}
        </div>
      </div>

      <div className={s.tableWrapFill}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Подразделение</th><th>Направление</th><th>Руководитель</th><th>Ответственный</th>
              <th>HRBP</th><th>Цель сбора</th><th>Скрыто</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => (
              <tr key={row.id}>
                <td><button type="button" className={s.linkBtn} onClick={() => setEditing(row)}>{row.unit}</button></td>
                <td>{row.dir}</td>
                <td>{row.head}</td>
                <td>{row.resp}</td>
                <td>{row.hrbp}</td>
                <td>{row.is_survey_target ? 'да' : ''}</td>
                <td>{row.is_hidden ? 'да' : ''}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <Button size="sm" variant="secondary" onClick={() => setMoving(row)}>Переместить</Button>
                  {isAdmin && (
                    <Button size="sm" variant="secondary" onClick={() => d.setHidden({ unit: row.unit, hidden: !row.is_hidden })}>
                      {row.is_hidden ? 'Показать' : 'Скрыть'}
                    </Button>
                  )}
                  {isAdmin && (
                    <Button
                      size="sm" variant="danger"
                      onClick={() => { if (confirm(`Удалить подразделение «${row.unit}»?`)) d.remove(row.unit); }}
                    >
                      Удалить
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={8} className={s.empty}>Подразделения не найдены</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <DivisionForm
          division={editing}
          onClose={() => setEditing(null)}
          onSubmit={p => { d.save(p); setEditing(null); }}
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
