import { useState } from 'react';
import type { BenchmarkSource } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { Select } from '../../../design/Select';
import { Skeleton } from '../../../design/Skeleton';
import s from '../Admin.module.css';
import { useMappings } from './useBenchmarkAdmin';

export function MappingTab({ sources }: { sources: BenchmarkSource[] }) {
  const [sourceKey, setSourceKey] = useState(sources.find(s2 => s2.key !== 'internal')?.key ?? sources[0]?.key ?? '');
  const m = useMappings(sourceKey);

  return (
    <div>
      <div className={s.head}>
        <Select label="Источник" value={sourceKey} onChange={e => setSourceKey(e.target.value)} options={sources.map(src => ({ value: src.key, label: src.title }))} />
      </div>

      <h4 className={s.hint}>Уже сопоставлено</h4>
      {m.mappingsLoading ? <Skeleton lines={3} /> : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Наша должность</th><th>Должность источника</th><th>Точность</th><th></th></tr></thead>
            <tbody>
              {(m.mappings ?? []).map(row => (
                <tr key={row.id}>
                  <td>{row.dict_position_name}</td>
                  <td>{row.source_label}</td>
                  <td>{row.confidence}</td>
                  <td><Button size="sm" variant="danger" onClick={() => { if (confirm('Удалить сопоставление?')) m.remove(row.id); }}>Удалить</Button></td>
                </tr>
              ))}
              {!m.mappings?.length && <tr><td colSpan={4} className={s.empty}>Сопоставлений ещё нет</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <h4 className={s.hint} style={{ marginTop: 'var(--s-4)' }}>Автоподсказки для несопоставленных</h4>
      {m.suggestionsLoading ? <Skeleton lines={3} /> : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Должность источника</th><th>Предполагаемое соответствие</th><th></th></tr></thead>
            <tbody>
              {(m.suggestions ?? []).map(row => (
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
      )}
    </div>
  );
}
