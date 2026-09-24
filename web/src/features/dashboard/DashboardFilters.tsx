import type { DashboardResponse } from '../../api/contract';
import { dashboardApi } from '../../api/dashboard';
import { Button } from '../../design/Button';
import { Input } from '../../design/Input';
import { Select } from '../../design/Select';
import type { useDashboard } from './useDashboard';
import s from './Dashboard.module.css';

type Hook = ReturnType<typeof useDashboard>;

/**
 * Одна панель фильтров над всеми вкладками (направление, HR BP каскадом от
 * направления, регион, поиск по должности/компании) — период выбирается в
 * шапке приложения (`PeriodPicker`), здесь не дублируется.
 */
export function DashboardFilters({ d }: { d: Hook }) {
  const data: DashboardResponse | undefined = d.data;
  const dirs = data ? Object.keys(data.dirHrbp).sort((a, b) => a.localeCompare(b, 'ru')) : [];
  const hrbps = data
    ? (d.filters.dir ? data.dirHrbp[d.filters.dir] ?? [] : Array.from(new Set(Object.values(data.dirHrbp).flat())).sort((a, b) => a.localeCompare(b, 'ru')))
    : [];

  return (
    <div className={s.filters}>
      <Input
        className={s.search} label="Поиск" placeholder="Должность, компания"
        value={d.searchInput} onChange={e => d.setSearchInput(e.target.value)}
      />
      <Select
        className={s.picker} label="Направление" placeholder="— все —"
        value={d.filters.dir ?? ''} options={dirs.map(v => ({ value: v, label: v }))}
        onChange={e => d.patch({ dir: e.target.value || undefined, hrbp: undefined })}
      />
      <Select
        className={s.picker} label="HR BP" placeholder="— все —"
        value={d.filters.hrbp ?? ''} options={hrbps.map(v => ({ value: v, label: v }))}
        onChange={e => d.patch({ hrbp: e.target.value || undefined })}
      />
      <Select
        className={s.picker} label="Регион" placeholder="— все —"
        value={d.filters.region ?? ''} options={(data?.regions ?? []).map(v => ({ value: v, label: v }))}
        onChange={e => d.patch({ region: e.target.value || undefined })}
      />
      {d.active > 0 && <Button variant="ghost" size="sm" onClick={d.reset}>Сбросить</Button>}
      <Button
        variant="secondary" size="sm" disabled={!data || data.summary.totalSurveyRecords === 0}
        onClick={() => { window.location.href = dashboardApi.exportCsvUrl(d.filters); }}
      >
        Экспорт CSV
      </Button>
      {data?.scoped && <span className={s.scopeNote}>Показаны только ваши подразделения</span>}
    </div>
  );
}
