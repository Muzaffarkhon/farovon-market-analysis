import { useState } from 'react';
import { NavLink } from 'react-router';
import type { GradingPosition } from '../../api/contract';
import { Button } from '../../design/Button';
import { RankBar } from '../../design/RankBar';
import { Skeleton } from '../../design/Skeleton';
import { useSessionData } from '../auth/useSession';
import { useScreenTitle } from '../shell/Shell';
import { BlocksList } from './BlocksList';
import { CommitteeBreakdownSheet } from './CommitteeBreakdownSheet';
import { GradingStats } from './GradingStats';
import { PositionForm } from './PositionForm';
import { PositionsList } from './PositionsList';
import { useGrading } from './useGrading';
import s from './Grading.module.css';

export function GradingScreen() {
  useScreenTitle('Оценка должностей');
  const g = useGrading();
  const { user } = useSessionData();
  const canManage = user.role === 'admin' || user.capabilities.includes('grading:blocks');
  const canSeeBreakdown = user.role === 'admin' || user.capabilities.includes('grading:blocks') || user.capabilities.includes('grading:committee');
  const [statsOpen, setStatsOpen] = useState(false);
  const [selected, setSelected] = useState<GradingPosition | null>(null);
  const [breakdown, setBreakdown] = useState<GradingPosition | null>(null);

  if (g.blocksError) return <p className={s.empty}>{g.blocksError.message}</p>;
  if (g.blocksLoading) return <Skeleton lines={4} />;

  const blocks = g.blocks ?? [];
  const currentBlock = blocks.find(b => b.key === g.block);

  if (!g.block) {
    return (
      <div data-wide>
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
    <div className={s.screenFill} data-wide>
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
      {currentBlock && (
        <RankBar
          label={`${currentBlock.evaluated_count} из ${currentBlock.position_count} должностей оценено`}
          pct={currentBlock.position_count > 0 ? Math.round((currentBlock.evaluated_count / currentBlock.position_count) * 100) : 0}
        />
      )}
      {g.positionsError && <p className={s.empty}>{g.positionsError.message}</p>}
      {g.positionsLoading && <Skeleton lines={6} />}
      {!g.positionsLoading && !g.positionsError && g.positions && (
        <PositionsList
          rows={g.positions.rows}
          committeeSize={g.positions.committeeSize}
          grades={g.factors?.grades ?? []}
          onSelect={setSelected}
          canSeeBreakdown={canSeeBreakdown}
          onShowBreakdown={setBreakdown}
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
          canManage={canManage}
          onReset={() => { g.reset(selected.job_title); setSelected(null); }}
          resetting={g.resetting}
          onRestore={() => { g.restore(selected.job_title); setSelected(null); }}
          restoring={g.restoring}
        />
      )}
      {breakdown && g.factors && g.block && (
        <CommitteeBreakdownSheet
          block={g.block}
          jobTitle={breakdown.job_title}
          criteria={g.factors.criteria}
          onClose={() => setBreakdown(null)}
        />
      )}
    </div>
  );
}
