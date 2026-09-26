import { useState } from 'react';
import { NavLink } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { KeyRisk } from '../../api/contract';
import { gradingApi } from '../../api/grading';
import { Button } from '../../design/Button';
import { Skeleton } from '../../design/Skeleton';
import { useScreenTitle } from '../shell/Shell';
import { DirectionsList } from './DirectionsList';
import { RiskForm } from './RiskForm';
import { RiskList } from './RiskList';
import { useKeyRisks } from './useKeyRisks';
import s from './KeyRisks.module.css';

export function KeyRisksScreen() {
  useScreenTitle('Риски');
  const k = useKeyRisks();
  const factors = useQuery({ queryKey: ['grading-factors-default'], queryFn: () => gradingApi.factors() });
  const [form, setForm] = useState<{ open: boolean; editing: KeyRisk | null }>({ open: false, editing: null });

  if (k.heatmapError) return <p className={s.empty}>{k.heatmapError.message}</p>;
  if (k.heatmapLoading) return <Skeleton lines={4} />;

  const dirs = k.heatmap ?? [];
  const form_ = form.open && factors.data && (
    <RiskForm
      riskFactors={factors.data.riskFactors}
      editing={form.editing}
      submitting={k.evaluating}
      onClose={() => setForm({ open: false, editing: null })}
      onSubmit={a => { k.evaluate(a); setForm({ open: false, editing: null }); }}
    />
  );

  if (!k.dir) {
    return (
      <div data-wide>
        <div className={s.head}>
          <Button onClick={() => setForm({ open: true, editing: null })}>Оценить сотрудника</Button>
        </div>
        <DirectionsList rows={dirs} />
        {form_}
      </div>
    );
  }

  const current = dirs.find(d => d.dir === k.dir);

  return (
    <div className={s.screenFill} data-wide>
      <nav className={s.tabs} aria-label="Направления">
        {dirs.map(d => (
          <NavLink
            key={d.dir} to={`/key-risks/${encodeURIComponent(d.dir)}`}
            className={({ isActive }) => [s.tab, isActive ? s.tabActive : ''].join(' ')}
          >
            {d.dir}
          </NavLink>
        ))}
      </nav>
      <div className={s.headBetween}>
        {current && (
          <p className={s.dirSummary}>
            {current.total} сотрудников оценено
            {current.critical > 0 && <> · <span className={s.critical}>{current.critical} критических</span></>}
            {current.attention > 0 && <> · <span className={s.cellWarn}>{current.attention} в зоне внимания</span></>}
          </p>
        )}
        <Button onClick={() => setForm({ open: true, editing: null })}>Оценить сотрудника</Button>
      </div>
      {k.dirRowsLoading ? <Skeleton lines={6} /> : (
        <RiskList
          rows={k.dirRows}
          onEdit={row => setForm({ open: true, editing: row })}
          onDelete={id => k.remove(id)}
        />
      )}
      {form_}
    </div>
  );
}
