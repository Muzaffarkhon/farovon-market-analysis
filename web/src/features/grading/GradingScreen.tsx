import { useState } from 'react';
import { NavLink } from 'react-router';
import type { GradingPosition } from '../../api/contract';
import { Button } from '../../design/Button';
import { Skeleton } from '../../design/Skeleton';
import { useScreenTitle } from '../shell/Shell';
import { BlocksList } from './BlocksList';
import { GradingStats } from './GradingStats';
import { PositionForm } from './PositionForm';
import { PositionsList } from './PositionsList';
import { useGrading } from './useGrading';
import s from './Grading.module.css';

export function GradingScreen() {
  useScreenTitle('Оценка должностей');
  const g = useGrading();
  const [statsOpen, setStatsOpen] = useState(false);
  const [selected, setSelected] = useState<GradingPosition | null>(null);

  if (g.blocksError) return <p className={s.empty}>{g.blocksError.message}</p>;
  if (g.blocksLoading) return <Skeleton lines={4} />;

  const blocks = g.blocks ?? [];

  if (!g.block) {
    return (
      <div>
        <div className={s.formFoot} style={{ justifyContent: 'flex-end', marginBottom: 'var(--s-3)' }}>
          <Button variant="secondary" size="sm" onClick={() => setStatsOpen(v => !v)}>
            {statsOpen ? 'Скрыть сводку' : 'Сводка по грейдам'}
          </Button>
        </div>
        {statsOpen && <div style={{ marginBottom: 'var(--s-4)' }}><GradingStats blocks={blocks} /></div>}
        <BlocksList blocks={blocks} />
      </div>
    );
  }

  return (
    <div className={s.screenFill}>
      <nav className={s.tabs} aria-label="Индустриальные блоки">
        {blocks.map(b => (
          <NavLink
            key={b.key} to={`/grading/${b.key}`}
            className={({ isActive }) => [s.tab, isActive ? s.tabActive : ''].join(' ')}
          >
            {b.label}
          </NavLink>
        ))}
      </nav>
      {g.positionsError && <p className={s.empty}>{g.positionsError.message}</p>}
      {g.positionsLoading && <Skeleton lines={6} />}
      {!g.positionsLoading && !g.positionsError && g.positions && (
        <PositionsList
          rows={g.positions.rows}
          committeeSize={g.positions.committeeSize}
          grades={g.factors?.grades ?? []}
          onSelect={setSelected}
        />
      )}
      {selected && g.factors && (
        <PositionForm
          row={selected}
          criteria={g.factors.criteria}
          committeeSize={g.positions?.committeeSize ?? 0}
          onClose={() => setSelected(null)}
          onSubmit={a => { g.evaluate(a); setSelected(null); }}
          submitting={g.evaluating}
        />
      )}
    </div>
  );
}
