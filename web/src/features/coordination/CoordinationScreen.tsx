import { Button } from '../../design/Button';
import { Skeleton } from '../../design/Skeleton';
import { useScreenTitle } from '../shell/Shell';
import { ActivityFeed } from './ActivityFeed';
import { PeopleProgress } from './PeopleProgress';
import { UnitsProgress } from './UnitsProgress';
import { useCoordination } from './useCoordination';
import s from './Coordination.module.css';

export function CoordinationScreen() {
  useScreenTitle('Координация');
  const c = useCoordination();

  if (c.error) return <p className={s.empty}>{c.error.message}</p>;
  if (c.isLoading) return <Skeleton lines={8} />;
  if (!c.data) return null;

  const { units, people, feed } = c.data;

  return (
    <div>
      <div className={s.head}>
        <Button onClick={c.remind} loading={c.reminding} disabled={!c.selected.size}>
          Напомнить{c.selected.size ? ` (${c.selected.size})` : ''}
        </Button>
      </div>

      {!units.length ? (
        <p className={s.empty}>Закреплённых направлений не найдено.</p>
      ) : (
        <div className={s.grid}>
          <UnitsProgress units={units} />
          <PeopleProgress people={people} selected={c.selected} onToggle={c.toggle} />
          <ActivityFeed feed={feed} />
        </div>
      )}
    </div>
  );
}
