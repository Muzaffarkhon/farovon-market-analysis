import { useState } from 'react';
import type { ReactNode } from 'react';
import type { RegistryRow } from '../../api/contract';
import { submitRegistryExport } from '../../api/registry';
import { Badge } from '../../design/Badge';
import { Button } from '../../design/Button';
import { ColumnPicker } from '../../design/ColumnPicker';
import { Input } from '../../design/Input';
import { Skeleton } from '../../design/Skeleton';
import { useTablePrefs } from '../../design/useTablePrefs';
import { scheduleLabel } from '../../domain/schedule';
import { useScreenTitle } from '../shell/Shell';
import { RecordSheet } from './RecordSheet';
import { ActiveFilters, RegistryFilters } from './RegistryFilters';
import { useRegistry } from './useRegistry';
import { isUnmapped, money, payRange, perLabel, recordSourceLabel, shortDate, shortDir, truncate } from './format';
import s from './Registry.module.css';

/**
 * Колонки таблицы: ключ сортировки и заголовок. Ключ — то же имя, что
 * сервер понимает в `sort` (см. SORTABLE в registryService.js); у колонок,
 * которых нет готовым полем строки (переменная часть, льготы), это отдельный
 * производный ключ — сервер знает, как его посчитать.
 */
const COLUMNS: { key: string; title: string; num?: boolean }[] = [
  { key: 'date', title: 'Дата' },
  { key: 'dir', title: 'Направление' },
  { key: 'unit', title: 'Подразделение' },
  { key: 'company', title: 'Компания' },
  { key: 'region', title: 'Регион' },
  { key: 'posOur', title: 'Наша должность' },
  { key: 'posTheir', title: 'У них' },
  { key: 'grade', title: 'Грейд' },
  { key: 'payFrom', title: 'Оклад от', num: true },
  { key: 'payTo', title: 'Оклад до', num: true },
  { key: 'cur', title: 'Вал. / период' },
  { key: 'varPayMonthly', title: 'Переменная часть' },
  { key: 'totalMonthly', title: 'Совокупно, мес.', num: true },
  { key: 'benefitsCount', title: 'Льготы' },
  { key: 'extra', title: 'Прочие выплаты' },
  { key: 'schedule', title: 'График' },
  { key: 'source', title: 'Источник' },
  { key: 'trust', title: 'Надёжность' },
  { key: 'note', title: 'Комментарий' },
  { key: 'by', title: 'Кто собрал' },
  { key: 'recordSource', title: 'Источник записи' }
];
const COLUMN_KEYS = COLUMNS.map(c => c.key);

/** Содержимое ячейки по ключу колонки — используется и для видимых, и для скрытых колонок одинаково. */
const CELLS: Record<string, (row: RegistryRow) => { className?: string; title?: string; node: ReactNode }> = {
  date: row => ({ className: [s.nowrap, s.muted].join(' '), node: shortDate(row.date) }),
  dir: row => ({ className: s.nowrap, title: row.dir, node: shortDir(row.dir) }),
  unit: row => ({ node: row.unit || '—' }),
  company: row => ({ node: <b>{row.company || '—'}</b> }),
  region: row => ({ node: row.region || '—' }),
  posOur: row => ({ node: isUnmapped(row) ? <Badge tone="warn">не сопоставлено</Badge> : row.posOur }),
  posTheir: row => ({ node: row.posTheir || '—' }),
  grade: row => ({ node: row.grade || '—' }),
  payFrom: row => ({ className: s.num, node: money(row.payFrom) }),
  payTo: row => ({ className: s.num, node: money(row.payTo) }),
  cur: row => ({ className: s.nowrap, node: perLabel(row) }),
  varPayMonthly: row => ({ node: row.varPay.label || '—' }),
  totalMonthly: row => ({ className: s.num, node: row.totalMonthly != null ? money(row.totalMonthly) : '—' }),
  benefitsCount: row => ({ node: row.benefits.length ? <Badge tone="ok">{row.benefits.length}</Badge> : <span className={s.muted}>—</span> }),
  extra: row => ({ className: s.nowrap, title: row.extra || undefined, node: row.extra ? truncate(row.extra) : <span className={s.muted}>—</span> }),
  schedule: row => ({ node: row.schedule ? scheduleLabel(row.schedule) : '—' }),
  source: row => ({ node: row.source || '—' }),
  trust: row => ({ node: row.trust || '—' }),
  note: row => ({ className: s.nowrap, title: row.note || undefined, node: row.note ? truncate(row.note) : <span className={s.muted}>—</span> }),
  by: row => ({ node: row.by || '—' }),
  recordSource: row => ({ node: recordSourceLabel(row.recordSource) })
};

export function RegistryScreen() {
  useScreenTitle('Реестр данных');
  const r = useRegistry();
  const [openRow, setOpenRow] = useState<RegistryRow | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const prefs = useTablePrefs('registry', COLUMN_KEYS);

  const data = r.data;
  const rows = data?.rows ?? [];
  const visibleColumns = COLUMNS.filter(c => prefs.visible.has(c.key));

  const mark = (key?: string) =>
    key && r.filters.sort === key ? <span className={s.sortMark}>{r.filters.order === 'asc' ? '↑' : '↓'}</span> : null;

  return (
    <div className={s.screen} data-wide>
      <div className={s.bar}>
        <Input
          className={s.search} label="Поиск" placeholder="Компания, должность, кто собрал"
          value={r.searchInput} onChange={e => r.setSearchInput(e.target.value)}
        />
        <Button variant="secondary" size="sm" onClick={() => setFiltersOpen(true)}>
          Фильтры{r.active ? ` · ${r.active}` : ''}
        </Button>
        {r.active > 0 && <Button variant="ghost" size="sm" onClick={r.reset}>Сбросить</Button>}
        <div className={s.barRight}>
          {data && (
            <span className={s.count}>
              {data.total === data.totalAll
                ? `${data.total} записей`
                : `${data.total} из ${data.totalAll}`}
            </span>
          )}
          <ColumnPicker columns={COLUMNS} visible={prefs.visible} onToggle={prefs.toggle} />
          <Button variant="secondary" size="sm" disabled={!data?.total} onClick={() => submitRegistryExport(r.filters)}>
            Выгрузить
          </Button>
        </div>
      </div>

      <ActiveFilters r={r} />
      {data?.scoped && <span className={s.scopeNote}>Показаны только ваши подразделения</span>}
      <RegistryFilters r={r} open={filtersOpen} onClose={() => setFiltersOpen(false)} />

      {r.error && <p className={s.empty}>{r.error.message}</p>}
      {r.isLoading && <Skeleton lines={6} />}

      {!r.isLoading && !r.error && !rows.length && (
        <p className={s.empty}>
          {r.active > 0
            ? <>Ничего не найдено. <button type="button" className={s.sortBtn} onClick={r.reset}>Сбросить фильтры</button></>
            : 'За этот период ещё ничего не собрано.'}
        </p>
      )}

      {!!rows.length && (
        <>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  {visibleColumns.map(c => (
                    <th key={c.key} className={c.num ? s.num : undefined}>
                      <button type="button" className={s.sortBtn} onClick={() => r.sortBy(c.key)}>{c.title}{mark(c.key)}</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} onClick={() => setOpenRow(row)}>
                    {visibleColumns.map(c => {
                      const cell = CELLS[c.key](row);
                      return <td key={c.key} className={cell.className} title={cell.title}>{cell.node}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={s.cards}>
            {rows.map(row => (
              <button type="button" key={row.id} className={s.card} onClick={() => setOpenRow(row)}>
                <span className={s.cardTop}>
                  <span className={s.cardTitle}>{row.company || '—'}</span>
                  <span className={s.cardPay}>{payRange(row)}</span>
                </span>
                <span className={s.cardSub}>
                  {isUnmapped(row) ? 'не сопоставлено' : row.posOur}
                  {row.posTheir ? ` ← ${row.posTheir}` : ''}
                </span>
                <span className={s.cardSub}>{shortDir(row.dir)} · {row.region || '—'} · {shortDate(row.date)}</span>
              </button>
            ))}
          </div>

          {data && data.pages > 1 && (
            <div className={s.pager}>
              <Button variant="secondary" size="sm" disabled={data.page <= 1} onClick={() => r.patch({ page: data.page - 1 }, false)}>Назад</Button>
              <span className={s.pagerInfo}>Страница {data.page} из {data.pages}</span>
              <Button variant="secondary" size="sm" disabled={data.page >= data.pages} onClick={() => r.patch({ page: data.page + 1 }, false)}>Вперёд</Button>
            </div>
          )}
        </>
      )}

      <RecordSheet row={openRow} onClose={() => setOpenRow(null)} />
    </div>
  );
}
