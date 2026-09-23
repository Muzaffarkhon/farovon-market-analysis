import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { KeyRisk } from '../../api/contract';
import { gradingApi } from '../../api/grading';
import { Button } from '../../design/Button';
import { KpiTile } from '../../design/KpiTile';
import { Skeleton } from '../../design/Skeleton';
import { useScreenTitle } from '../shell/Shell';
import { RiskForm } from './RiskForm';
import { RiskHeatmap } from './RiskHeatmap';
import { RiskList } from './RiskList';
import { useKeyRisks } from './useKeyRisks';
import s from './KeyRisks.module.css';

export function KeyRisksScreen() {
  useScreenTitle('Риски');
  const k = useKeyRisks();
  const factors = useQuery({ queryKey: ['grading-factors-default'], queryFn: () => gradingApi.factors() });
  const [form, setForm] = useState<{ open: boolean; editing: KeyRisk | null }>({ open: false, editing: null });

  if (k.heatmapError) return <p className={s.empty}>{k.heatmapError.message}</p>;
  if (k.heatmapLoading) return <Skeleton lines={6} />;

  const rows = k.heatmap ?? [];
  const totals = rows.reduce((a, r) => ({
    total: a.total + r.total, critical: a.critical + r.critical,
    attention: a.attention + r.attention, standard: a.standard + r.standard
  }), { total: 0, critical: 0, attention: 0, standard: 0 });

  return (
    <div>
      <div className={s.head}>
        <Button onClick={() => setForm({ open: true, editing: null })}>Оценить сотрудника</Button>
      </div>

      <div className={s.grid}>
        <KpiTile label="Оценено сотрудников" value={totals.total} />
        <KpiTile label="Критический риск" value={totals.critical} tone={totals.critical ? 'warn' : undefined} hint="Нужен план преемственности" />
        <KpiTile label="Зона внимания" value={totals.attention} hint="Под наблюдением" />
        <KpiTile label="Штатных" value={totals.standard} tone="ok" hint="Есть замена" />
      </div>

      <h3 className={s.sectionTitle}>Направление и индустриальный блок</h3>
      <RiskHeatmap rows={rows} />

      <h3 className={s.sectionTitle}>Требуют внимания</h3>
      {k.rowsLoading ? <Skeleton lines={4} /> : (
        <RiskList
          rows={k.rows}
          onEdit={row => setForm({ open: true, editing: row })}
          onDelete={id => k.remove(id)}
        />
      )}

      {form.open && factors.data && (
        <RiskForm
          riskFactors={factors.data.riskFactors}
          editing={form.editing}
          submitting={k.evaluating}
          onClose={() => setForm({ open: false, editing: null })}
          onSubmit={a => { k.evaluate(a); setForm({ open: false, editing: null }); }}
        />
      )}
    </div>
  );
}
