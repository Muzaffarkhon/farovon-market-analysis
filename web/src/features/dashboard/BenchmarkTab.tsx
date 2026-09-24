import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { BenchmarkSourceResult, DashboardResponse } from '../../api/contract';
import { benchmarkApi } from '../../api/benchmark';
import { Button } from '../../design/Button';
import { Combobox } from '../../design/Combobox';
import { KpiTile } from '../../design/KpiTile';
import { Skeleton } from '../../design/Skeleton';
import { SortTh } from '../../design/SortTh';
import { useSort } from '../../design/useSort';
import { money } from '../registry/format';
import s from './Dashboard.module.css';

const verdict = (compaRatio: number | null) => {
  if (compaRatio == null) return null;
  if (compaRatio < 0.9) return 'Ниже рынка';
  if (compaRatio > 1.1) return 'Выше рынка';
  return 'Оклад в рынке';
};

function SourceRow({ title, hasData, p50, gapPercent, sharePct, dataAsOf }: {
  title: string; hasData: boolean; p50: number; gapPercent: number | null; sharePct: number; dataAsOf?: string;
}) {
  return (
    <tr>
      <td><b>{title}</b></td>
      <td className={s.num}>{dataAsOf || '—'}</td>
      <td className={s.num}>{hasData ? money(p50) : 'нет данных'}</td>
      <td className={s.num}>
        {gapPercent != null
          ? <span className={gapPercent < 0 ? s.gapDown : s.gapUp}>{gapPercent > 0 ? '+' : ''}{gapPercent}%</span>
          : '—'}
      </td>
      <td>
        <div className={s.weightCell}>
          <div className={s.weightBar}><i style={{ width: `${Math.max(0, Math.min(100, sharePct))}%` }} /></div>
          <b>{sharePct}</b>
        </div>
      </td>
    </tr>
  );
}

/**
 * Сравнение по должности с внешними источниками — только чтение (compare +
 * summary-widgets, право `benchmarks:view`). Настройка источников, импорт
 * датасетов и сопоставление должностей — инструменты администратора,
 * их здесь нет (этап 6).
 */
export function BenchmarkTab({ data }: { data: DashboardResponse }) {
  const positions = [...new Set(data.positions.map(p => p.pos))].sort((a, b) => a.localeCompare(b, 'ru'));
  const [pos, setPos] = useState('');

  const widgets = useQuery({ queryKey: ['benchmark-widgets'], queryFn: () => benchmarkApi.summaryWidgets() });
  const compare = useQuery({
    queryKey: ['benchmark-compare', pos],
    queryFn: () => benchmarkApi.compare(pos),
    enabled: !!pos
  });

  const compareRows: { key: string; source: BenchmarkSourceResult | (typeof compare.data extends undefined ? never : NonNullable<typeof compare.data>['result']['internal']) }[] = compare.data
    ? [{ key: 'internal', source: compare.data.result.internal }, ...compare.data.result.external.map(e => ({ key: e.sourceKey, source: e }))]
    : [];
  const rowsSort = useSort(compareRows, (row, key) => {
    const src = row.source;
    switch (key) {
      case 'title': return src.sourceTitle;
      case 'dataAsOf': return 'dataAsOf' in src ? (src.dataAsOf ?? '') : '';
      case 'p50': return src.stats?.p50 ?? 0;
      case 'gap': return src.gapPercent ?? -Infinity;
      case 'share': return src.share;
      default: return '';
    }
  });

  return (
    <div className={s.screenFill}>
      <div className={s.filters} style={{ justifyContent: 'space-between' }}>
        {widgets.data && (
          <p className={s.scopeNote}>
            Источники сопоставлены для {widgets.data.widgets.mappedPositions} из {widgets.data.widgets.totalPositions} должностей ({widgets.data.widgets.coveragePercent}%)
          </p>
        )}
        <Button
          variant="secondary" size="sm" disabled={!widgets.data || widgets.data.widgets.mappedPositions === 0}
          onClick={() => { window.location.href = benchmarkApi.exportUrl(); }}
        >
          Экспорт матрицы CSV
        </Button>
      </div>

      <Combobox
        label="Должность" placeholder="— выберите —"
        value={pos} options={positions.map(v => ({ value: v, label: v }))}
        onChange={setPos}
      />

      {!pos && <p className={s.empty}>Выберите должность, чтобы сравнить с внешними источниками.</p>}
      {pos && compare.isLoading && <Skeleton lines={6} />}
      {pos && compare.error && <p className={s.empty}>{(compare.error as Error).message}</p>}

      {pos && compare.data && (() => {
        const r = compare.data.result;
        const v = verdict(r.summary.compaRatio);
        return (
          <>
            <div className={s.grid}>
              <KpiTile label="Вердикт" value={v ?? '—'} hint={`Взвешенная медиана рынка — ${money(r.summary.compositeMedian)}, наш оклад — ${money(r.position.ourMid)}`} />
              <KpiTile label="Compa-ratio" value={r.summary.compaRatio ?? '—'} hint="Норма — от 0,90 до 1,10" />
              <KpiTile
                label="Отклонение от рынка" unit={r.summary.compositeGapPercent != null ? '%' : undefined}
                value={r.summary.compositeGapPercent != null ? `${r.summary.compositeGapPercent > 0 ? '+' : ''}${r.summary.compositeGapPercent}` : '—'}
                tone={r.summary.compositeGapPercent != null ? (r.summary.compositeGapPercent < 0 ? 'warn' : 'ok') : undefined}
              />
            </div>

            <div className={s.tableWrapFill}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <SortTh label="Источник" sortKey="title" activeKey={rowsSort.sortKey} dir={rowsSort.sortDir} onSort={rowsSort.sortBy} />
                    <SortTh label="Данные на" sortKey="dataAsOf" activeKey={rowsSort.sortKey} dir={rowsSort.sortDir} onSort={rowsSort.sortBy} numeric />
                    <SortTh label="Медиана, сомони" sortKey="p50" activeKey={rowsSort.sortKey} dir={rowsSort.sortDir} onSort={rowsSort.sortBy} numeric />
                    <SortTh label="Мы к источнику" sortKey="gap" activeKey={rowsSort.sortKey} dir={rowsSort.sortDir} onSort={rowsSort.sortBy} numeric />
                    <SortTh label="Вес в расчёте" sortKey="share" activeKey={rowsSort.sortKey} dir={rowsSort.sortDir} onSort={rowsSort.sortBy} numeric />
                  </tr>
                </thead>
                <tbody>
                  {rowsSort.sorted.map(({ key, source }) => (
                    <SourceRow
                      key={key} title={source.sourceTitle}
                      hasData={'hasData' in source ? source.hasData : true}
                      p50={source.stats?.p50 ?? 0} gapPercent={source.gapPercent}
                      sharePct={Math.round(source.share * 100)}
                      dataAsOf={'dataAsOf' in source ? source.dataAsOf : undefined}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        );
      })()}
    </div>
  );
}
