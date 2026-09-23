import { useState } from 'react';
import type { RegistryRow } from '../../api/contract';
import { submitRegistryExport } from '../../api/registry';
import { Badge } from '../../design/Badge';
import { Button } from '../../design/Button';
import { Input } from '../../design/Input';
import { Skeleton } from '../../design/Skeleton';
import { scheduleLabel } from '../../domain/schedule';
import { useScreenTitle } from '../shell/Shell';
import { RecordSheet } from './RecordSheet';
import { ActiveFilters, RegistryFilters } from './RegistryFilters';
import { useRegistry } from './useRegistry';
import { isUnmapped, money, payRange, perLabel, shortDate, shortDir } from './format';
import s from './Registry.module.css';

/** Колонки таблицы: ключ сортировки (если колонка сортируемая) и заголовок. */
const COLUMNS: { key?: string; title: string; num?: boolean }[] = [
  { key: 'date', title: 'Дата' },
  { key: 'dir', title: 'Направление' },
  { key: 'unit', title: 'Подразделение' },
  { key: 'company', title: 'Компания' },
  { title: 'Регион' },
  { key: 'posOur', title: 'Наша должность' },
  { title: 'У них' },
  { title: 'Грейд' },
  { key: 'payFrom', title: 'Оклад от', num: true },
  { key: 'payTo', title: 'Оклад до', num: true },
  { title: 'Вал. / период' },
  { title: 'Переменная часть' },
  { title: 'Льготы' },
  { title: 'График' },
  { key: 'source', title: 'Источник' },
  { key: 'trust', title: 'Надёжность' },
  { key: 'by', title: 'Кто собрал' }
];

export function RegistryScreen() {
  useScreenTitle('Реестр данных');
  const r = useRegistry();
  const [openRow, setOpenRow] = useState<RegistryRow | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const data = r.data;
  const rows = data?.rows ?? [];

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
                  {COLUMNS.map(c => (
                    <th key={c.title} className={c.num ? s.num : undefined}>
                      {c.key
                        ? <button type="button" className={s.sortBtn} onClick={() => r.sortBy(c.key!)}>{c.title}{mark(c.key)}</button>
                        : c.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} onClick={() => setOpenRow(row)}>
                    <td className={[s.nowrap, s.muted].join(' ')}>{shortDate(row.date)}</td>
                    <td className={s.nowrap} title={row.dir}>{shortDir(row.dir)}</td>
                    <td>{row.unit || '—'}</td>
                    <td><b>{row.company || '—'}</b></td>
                    <td>{row.region || '—'}</td>
                    <td>{isUnmapped(row) ? <Badge tone="warn">не сопоставлено</Badge> : row.posOur}</td>
                    <td>{row.posTheir || '—'}</td>
                    <td>{row.grade || '—'}</td>
                    <td className={s.num}>{money(row.payFrom)}</td>
                    <td className={s.num}>{money(row.payTo)}</td>
                    <td className={s.nowrap}>{perLabel(row)}</td>
                    <td>{row.varPay.label || '—'}</td>
                    <td>{row.benefits.length ? <Badge tone="ok">{row.benefits.length}</Badge> : <span className={s.muted}>—</span>}</td>
                    <td>{row.schedule ? scheduleLabel(row.schedule) : '—'}</td>
                    <td>{row.source || '—'}</td>
                    <td>{row.trust || '—'}</td>
                    <td>{row.by || '—'}</td>
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
