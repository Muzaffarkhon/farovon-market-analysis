import { NavLink } from 'react-router';
import { Skeleton } from '../../design/Skeleton';
import { useScreenTitle } from '../shell/Shell';
import { BlocksList } from './BlocksList';
import { useGrading } from './useGrading';
import s from './Grading.module.css';

export function GradingScreen() {
  useScreenTitle('Оценка должностей');
  const g = useGrading();

  if (g.blocksError) return <p className={s.empty}>{g.blocksError.message}</p>;
  if (g.blocksLoading) return <Skeleton lines={4} />;

  const blocks = g.blocks ?? [];

  if (!g.block) return <BlocksList blocks={blocks} />;

  return (
    <div>
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
        <p className={s.empty}>{g.positions.rows.length} должностей в блоке «{g.positions.block.label}» — список появится на следующем шаге.</p>
      )}
    </div>
  );
}
