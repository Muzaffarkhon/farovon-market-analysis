import type { HeatmapRow } from '../../api/contract';
import s from './KeyRisks.module.css';

/** Направление × уровень риска → число сотрудников, по мокапу 07-risks.html. */
export function RiskHeatmap({ rows }: { rows: HeatmapRow[] }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Направление</th>
            <th className={s.num}>Штатный</th>
            <th className={s.num}>Зона внимания</th>
            <th className={s.num}>Критический</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.dir}>
              <td><b>{r.dir}</b></td>
              <td className={[s.num, s.cellOk].join(' ')}>{r.standard || '—'}</td>
              <td className={[s.num, s.cellWarn].join(' ')}>{r.attention || '—'}</td>
              <td className={[s.num, s.cellDanger].join(' ')}>{r.critical || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className={s.empty}>Пока ничего не оценено.</p>}
    </div>
  );
}
