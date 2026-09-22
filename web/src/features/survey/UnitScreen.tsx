import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError } from '../../api/client';
import { Chip } from '../../design/Chip';
import { Input } from '../../design/Input';
import { Skeleton } from '../../design/Skeleton';
import type { PositionState } from '../../domain/progress';
import { useScreenTitle } from '../shell/Shell';
import { usePeriodId } from '../shell/usePeriodId';
import { PositionCard } from './PositionCard';
import { useUnitData } from './useUnitData';
import s from './Survey.module.css';

type Filter = 'all' | 'untouched' | 'partial' | 'done' | 'none';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'untouched', label: 'Не начаты' },
  { key: 'partial', label: 'В работе' },
  { key: 'done', label: 'Заполнены' },
  { key: 'none', label: 'Не с кем' }
];

export function UnitScreen() {
  const { unit = '' } = useParams();
  const decoded = decodeURIComponent(unit);
  useScreenTitle(decoded);
  const periodId = usePeriodId();
  const navigate = useNavigate();
  const data = useUnitData(decoded, periodId);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const states = useMemo(() => {
    const map = new Map<string, PositionState>();
    data.positions.forEach(p => map.set(p, data.stateOf(p)));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.positions, data.drafts, data.selections, data.noComparison]);

  if (data.isLoading) return <Skeleton lines={8} />;
  if (data.error) return <p className={s.empty}>{data.error instanceof ApiError ? data.error.message : 'Не удалось загрузить данные подразделения'}</p>;
  if (!data.positions.length) {
    return <p className={s.empty}>Для этого подразделения не заведена штатка — обратитесь к C&amp;B.</p>;
  }

  const q = search.trim().toLowerCase();
  const shown = data.positions.filter(p => {
    const st = states.get(p)!;
    if (filter !== 'all' && st.kind !== filter) return false;
    return !q || p.toLowerCase().includes(q);
  });
  const { decided, total } = data.progress;

  return (
    <div>
      <div className={s.head}>
        <div className={s.progressLine}>
          <progress value={decided} max={total || 1} />
          <span className={s.progressText}>решено {decided} из {total}</span>
        </div>
        {data.positions.length > 3 && (
          <>
            <div className={s.filters}>
              {FILTERS.map(f => (
                <Chip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</Chip>
              ))}
            </div>
            <Input className={s.search} label="Поиск" placeholder="Должность" value={search} onChange={e => setSearch(e.target.value)} />
          </>
        )}
      </div>
      <div className={s.list}>
        {shown.map(p => (
          <PositionCard
            key={p}
            position={p}
            state={states.get(p)!}
            companies={data.selections[p] ?? []}
            onOpen={() => navigate(`/survey/${encodeURIComponent(decoded)}/${encodeURIComponent(p)}${periodId ? `?period=${periodId}` : ''}`)}
          />
        ))}
        {!shown.length && <p className={s.empty}>Ничего не найдено.</p>}
      </div>
    </div>
  );
}
