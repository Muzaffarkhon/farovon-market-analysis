import { useState } from 'react';
import { Button } from '../../../design/Button';
import { Chip } from '../../../design/Chip';
import { Skeleton } from '../../../design/Skeleton';
import { useScreenTitle } from '../../shell/Shell';
import s from '../Admin.module.css';
import { BenchmarkImportWizard } from './BenchmarkImportWizard';
import { DatasetsTab } from './DatasetsTab';
import { MappingTab } from './MappingTab';
import { SourcesTab } from './SourcesTab';
import { useSources } from './useBenchmarkAdmin';

export function BenchmarkAdminScreen() {
  useScreenTitle('Бенчмаркинг');
  const [tab, setTab] = useState<'sources' | 'mapping' | 'datasets'>('sources');
  const [wizardOpen, setWizardOpen] = useState(false);
  const src = useSources();

  if (src.error) return <p className={s.empty}>{src.error.message}</p>;
  if (src.loading) return <Skeleton lines={4} />;

  const sources = src.sources ?? [];

  return (
    <div className={s.form} data-wide>
      <div className={s.head}>
        <div className={s.tabs}>
          <Chip active={tab === 'sources'} onClick={() => setTab('sources')}>Источники</Chip>
          <Chip active={tab === 'mapping'} onClick={() => setTab('mapping')}>Сопоставление</Chip>
          <Chip active={tab === 'datasets'} onClick={() => setTab('datasets')}>Наборы данных</Chip>
        </div>
        <Button size="sm" onClick={() => setWizardOpen(true)}>Импорт данных</Button>
      </div>

      {tab === 'sources' && <SourcesTab />}
      {tab === 'mapping' && <MappingTab sources={sources} />}
      {tab === 'datasets' && <DatasetsTab />}

      {wizardOpen && <BenchmarkImportWizard sources={sources} onClose={() => setWizardOpen(false)} />}
    </div>
  );
}
