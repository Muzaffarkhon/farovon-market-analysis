import { useMemo, useState } from 'react';
import { Chip } from '../../../design/Chip';
import { Skeleton } from '../../../design/Skeleton';
import { useScreenTitle } from '../../shell/Shell';
import s from '../Admin.module.css';
import { BlocksTab } from './BlocksTab';
import { CommitteeTab } from './CommitteeTab';
import { FactorsTab } from './FactorsTab';
import { useAdminBlocks } from './useGradingAdmin';

const UNASSIGNED_KEY = 'unassigned';

export function GradingAdminScreen() {
  useScreenTitle('Грейдирование — настройка');
  const [tab, setTab] = useState<'factors' | 'blocks' | 'committee'>('factors');
  const blocksQuery = useAdminBlocks();

  const allBlocks = blocksQuery.data?.rows ?? [];
  const realBlocks = useMemo(() => allBlocks.filter(b => b.key !== UNASSIGNED_KEY), [allBlocks]);

  if (blocksQuery.isLoading) return <Skeleton lines={4} />;
  if (blocksQuery.error) return <p className={s.empty}>{(blocksQuery.error as Error).message}</p>;

  return (
    <div className={s.form} data-wide>
      <div className={s.tabs}>
        <Chip active={tab === 'factors'} onClick={() => setTab('factors')}>Формулировки</Chip>
        <Chip active={tab === 'blocks'} onClick={() => setTab('blocks')}>Блоки</Chip>
        <Chip active={tab === 'committee'} onClick={() => setTab('committee')}>Комиссия</Chip>
      </div>
      {tab === 'factors' && <FactorsTab blocks={realBlocks} />}
      {tab === 'blocks' && <BlocksTab blocks={allBlocks} />}
      {tab === 'committee' && <CommitteeTab blocks={realBlocks} />}
    </div>
  );
}
