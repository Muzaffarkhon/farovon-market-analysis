import type { RegistryResponse } from '../../api/contract';
import { Button } from '../../design/Button';
import { Chip } from '../../design/Chip';
import { Combobox } from '../../design/Combobox';
import { Select } from '../../design/Select';
import { Sheet } from '../../design/Sheet';
import { scheduleLabel } from '../../domain/schedule';
import { recordSourceLabel } from './format';
import { PICKERS, type useRegistry } from './useRegistry';
import s from './Registry.module.css';

type Registry = ReturnType<typeof useRegistry>;

const pickerLabel = (facet: string, v: string) => {
  if (facet === 'schedules') return scheduleLabel(v);
  if (facet === 'recordSources') return recordSourceLabel(v);
  return v;
};
// Длинные справочники (сотни подразделений/компаний) — с поиском; короткие
// перечисления (регион, грейд, график и т.п.) хватает обычного select.
const SEARCHABLE = new Set(['unit', 'company']);

/**
 * Все фильтры реестра — в одной панели за кнопкой «Фильтры». Раньше на
 * компьютере десять списков стояли над таблицей всегда, а кнопка ничего не
 * делала; теперь экран отдан таблице, а панель одинакова на всех ширинах.
 * Фильтры применяются сразу — кнопка внизу только закрывает панель.
 */
export function RegistryFilters({ r, open, onClose }: { r: Registry; open: boolean; onClose: () => void }) {
  const data: RegistryResponse | undefined = r.data;
  return (
    <Sheet
      open={open} onClose={onClose} title="Фильтры"
      footer={
        <div className={s.filterFoot}>
          <Button variant="ghost" disabled={!r.active} onClick={r.reset}>Сбросить</Button>
          <Button onClick={onClose}>{data ? `Показать ${data.total}` : 'Показать'}</Button>
        </div>
      }
    >
      <div className={s.filterGrid}>
        {PICKERS.map(p => {
          const options = (data?.facets[p.facet] ?? []).map(v => ({ value: v, label: pickerLabel(p.facet, v) }));
          const value = (r.filters[p.key] as string) ?? '';
          return SEARCHABLE.has(p.key)
            ? (
              <Combobox
                key={p.key} label={p.label} placeholder="— все —"
                value={value} options={options}
                onChange={v => r.patch({ [p.key]: v || undefined })}
              />
            )
            : (
              <Select
                key={p.key} label={p.label} placeholder="— все —"
                value={value} options={options}
                onChange={e => r.patch({ [p.key]: e.target.value || undefined })}
              />
            );
        })}
      </div>
      <div className={s.flags}>
        <Chip active={!!r.filters.onlyUnmapped} onClick={() => r.patch({ onlyUnmapped: !r.filters.onlyUnmapped || undefined })}>
          Только несопоставленные{data ? ` (${data.unmapped})` : ''}
        </Chip>
        <Chip active={!!r.filters.withPayOnly} onClick={() => r.patch({ withPayOnly: !r.filters.withPayOnly || undefined })}>
          Только с окладом
        </Chip>
        <Chip active={!!r.filters.withExtraOnly} onClick={() => r.patch({ withExtraOnly: !r.filters.withExtraOnly || undefined })}>
          Только с прочими выплатами
        </Chip>
      </div>
    </Sheet>
  );
}

/** Выбранные фильтры строкой над таблицей: видно, что применено, и снимается одним нажатием. */
export function ActiveFilters({ r }: { r: Registry }) {
  const items: { key: string; text: string; clear: () => void }[] = [];
  for (const p of PICKERS) {
    const v = r.filters[p.key] as string | undefined;
    if (v) items.push({ key: p.key, text: `${p.label}: ${pickerLabel(p.facet, v)}`, clear: () => r.patch({ [p.key]: undefined }) });
  }
  if (r.filters.onlyUnmapped) items.push({ key: 'onlyUnmapped', text: 'Только несопоставленные', clear: () => r.patch({ onlyUnmapped: undefined }) });
  if (r.filters.withPayOnly) items.push({ key: 'withPayOnly', text: 'Только с окладом', clear: () => r.patch({ withPayOnly: undefined }) });
  if (r.filters.withExtraOnly) items.push({ key: 'withExtraOnly', text: 'Только с прочими выплатами', clear: () => r.patch({ withExtraOnly: undefined }) });
  if (!items.length) return null;
  return (
    <div className={s.flags}>
      {items.map(i => (
        <Chip key={i.key} active onClick={i.clear}>
          <span>{i.text}</span> <span aria-label="убрать">×</span>
        </Chip>
      ))}
    </div>
  );
}
