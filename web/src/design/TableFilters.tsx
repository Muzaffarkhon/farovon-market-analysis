import { useState } from 'react';
import { Button } from './Button';
import { Chip } from './Chip';
import { Input } from './Input';
import { Select } from './Select';
import { Sheet } from './Sheet';
import type { TableFilterField, useTableFilters } from './useTableFilters';
import s from './TableFilters.module.css';

type Filters<T> = ReturnType<typeof useTableFilters<T>>;

/** Кнопка «Фильтры» со счётчиком активных — открывает панель полей, по одному на столбец. */
export function TableFiltersButton<T>({ f, fields, size = 'sm' }: { f: Filters<T>; fields: TableFilterField<T>[]; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant="secondary" onClick={() => setOpen(true)}>
        Фильтры{f.active.length ? ` · ${f.active.length}` : ''}
      </Button>
      {open && (
        <Sheet
          open onClose={() => setOpen(false)} title="Фильтры"
          footer={
            <div className={s.foot}>
              <Button variant="ghost" disabled={!f.active.length} onClick={f.reset}>Сбросить</Button>
              <Button onClick={() => setOpen(false)}>Показать {f.filtered.length}</Button>
            </div>
          }
        >
          <div className={s.grid}>
            {fields.map(field => field.kind === 'select' ? (
              <Select
                key={field.key} label={field.label} placeholder="— все —"
                value={f.values[field.key] ?? ''}
                onChange={e => f.setValue(field.key, e.target.value)}
                options={(f.optionsByField[field.key] ?? []).map(v => ({ value: v, label: v }))}
              />
            ) : (
              <Input
                key={field.key} label={field.label}
                placeholder={field.kind === 'numeric' ? '>0   10-50' : 'фильтр'}
                value={f.values[field.key] ?? ''}
                onChange={e => f.setValue(field.key, e.target.value)}
              />
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

/** Чипы применённых фильтров под шапкой — видно, что включено, снимается по одному клику. */
export function ActiveTableFilterChips<T>({ f }: { f: Filters<T> }) {
  if (!f.active.length) return null;
  return (
    <div className={s.chips}>
      {f.active.map(field => (
        <Chip key={field.key} active onClick={() => f.setValue(field.key, '')}>
          <span>{field.label}: {f.values[field.key]}</span> <span aria-label="убрать">×</span>
        </Chip>
      ))}
    </div>
  );
}
