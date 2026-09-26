import { useState } from 'react';
import type { BenchmarkSource } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { useConfirm } from '../../../design/Confirm';
import { Select } from '../../../design/Select';
import { Skeleton } from '../../../design/Skeleton';
import { SortTh } from '../../../design/SortTh';
import { useSort } from '../../../design/useSort';
import s from '../Admin.module.css';
import { useMappings } from './useBenchmarkAdmin';

export function MappingTab({ sources }: { sources: BenchmarkSource[] }) {
  const [sourceKey, setSourceKey] = useState(sources.find(s2 => s2.key !== 'internal')?.key ?? sources[0]?.key ?? '');
  const m = useMappings(sourceKey);
  const confirm = useConfirm();

  const mappingsSort = useSort(m.mappings ?? [], (row, key) => {
    switch (key) {
      case 'our': return row.dict_position_name;
      case 'source': return row.source_label;
      case 'confidence': return row.confidence;
      default: return '';
    }
  });

  const suggestionsSort = useSort(m.suggestions ?? [], (row, key) => {
    switch (key) {
      case 'source': return row.sourcePosition.label;
      case 'suggested': return row.suggestedDictPosition.name;
      default: return '';
    }
  });

  return (
    <div>
      <div className={s.head}>
        <Select label="Источник" value={sourceKey} onChange={e => setSourceKey(e.target.value)} options={sources.map(src => ({ value: src.key, label: src.title }))} />
      </div>

      <h4 className={s.hint}>Уже сопоставлено</h4>
      {m.mappingsLoading ? <Skeleton lines={3} /> : (
        <>
          <div className={[s.tableWrap, s.hideOnMobile].join(' ')}>
            <table className={s.table}>
              <thead>
                <tr>
                  <SortTh label="Наша должность" sortKey="our" activeKey={mappingsSort.sortKey} dir={mappingsSort.sortDir} onSort={mappingsSort.sortBy} />
                  <SortTh label="Должность источника" sortKey="source" activeKey={mappingsSort.sortKey} dir={mappingsSort.sortDir} onSort={mappingsSort.sortBy} />
                  <SortTh label="Точность" sortKey="confidence" activeKey={mappingsSort.sortKey} dir={mappingsSort.sortDir} onSort={mappingsSort.sortBy} />
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {mappingsSort.sorted.map(row => (
                  <tr key={row.id}>
                    <td>{row.dict_position_name}</td>
                    <td>{row.source_label}</td>
                    <td>{row.confidence}</td>
                    <td><Button size="sm" variant="danger" onClick={async () => { if (await confirm({ message: 'Удалить сопоставление?', danger: true })) m.remove(row.id); }}>Удалить</Button></td>
                  </tr>
                ))}
                {!m.mappings?.length && <tr><td colSpan={4} className={s.empty}>Сопоставлений ещё нет</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Узкий экран: пара «наша ↔ источник» и точность — одной колонкой,
              кнопка удаления — второй, без отдельной колонки на каждое поле. */}
          <div className={s.tableWrapFill}>
            <table className={s.tableCompact}>
              <thead><tr><th>Сопоставление</th><th></th></tr></thead>
              <tbody>
                {mappingsSort.sorted.map(row => (
                  <tr key={row.id}>
                    <td>
                      {row.dict_position_name}
                      <div className={s.hint}>← {row.source_label} · {row.confidence}</div>
                    </td>
                    <td><Button size="sm" variant="danger" onClick={async () => { if (await confirm({ message: 'Удалить сопоставление?', danger: true })) m.remove(row.id); }}>Удалить</Button></td>
                  </tr>
                ))}
                {!m.mappings?.length && <tr><td colSpan={2} className={s.empty}>Сопоставлений ещё нет</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h4 className={s.hint} style={{ marginTop: 'var(--s-4)' }}>Автоподсказки для несопоставленных</h4>
      {m.suggestionsLoading ? <Skeleton lines={3} /> : (
        <>
          <div className={[s.tableWrap, s.hideOnMobile].join(' ')}>
            <table className={s.table}>
              <thead>
                <tr>
                  <SortTh label="Должность источника" sortKey="source" activeKey={suggestionsSort.sortKey} dir={suggestionsSort.sortDir} onSort={suggestionsSort.sortBy} />
                  <SortTh label="Предполагаемое соответствие" sortKey="suggested" activeKey={suggestionsSort.sortKey} dir={suggestionsSort.sortDir} onSort={suggestionsSort.sortBy} />
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {suggestionsSort.sorted.map(row => (
                  <tr key={row.sourcePosition.id}>
                    <td>{row.sourcePosition.label}</td>
                    <td>{row.suggestedDictPosition.name}</td>
                    <td>
                      <Button
                        size="sm"
                        onClick={() => m.save({ dictPositionId: row.suggestedDictPosition.id, sourcePositionId: row.sourcePosition.id, confidence: 'suggested' })}
                      >
                        Подтвердить
                      </Button>
                    </td>
                  </tr>
                ))}
                {!m.suggestions?.length && <tr><td colSpan={3} className={s.empty}>Подсказок нет — все должности сопоставлены или без явного соответствия</td></tr>}
              </tbody>
            </table>
          </div>

          <div className={s.tableWrapFill}>
            <table className={s.tableCompact}>
              <thead><tr><th>Соответствие</th><th></th></tr></thead>
              <tbody>
                {suggestionsSort.sorted.map(row => (
                  <tr key={row.sourcePosition.id}>
                    <td>
                      {row.sourcePosition.label}
                      <div className={s.hint}>→ {row.suggestedDictPosition.name}</div>
                    </td>
                    <td>
                      <Button
                        size="sm"
                        onClick={() => m.save({ dictPositionId: row.suggestedDictPosition.id, sourcePositionId: row.sourcePosition.id, confidence: 'suggested' })}
                      >
                        Подтвердить
                      </Button>
                    </td>
                  </tr>
                ))}
                {!m.suggestions?.length && <tr><td colSpan={2} className={s.empty}>Подсказок нет — все должности сопоставлены или без явного соответствия</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
