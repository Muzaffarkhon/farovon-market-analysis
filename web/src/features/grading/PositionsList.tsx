import type { GradingLevel, GradingPosition } from '../../api/contract';
import { Badge } from '../../design/Badge';
import { SortTh } from '../../design/SortTh';
import { useSort } from '../../design/useSort';
import s from './Grading.module.css';

function statusOf(row: GradingPosition, committeeSize: number, grades: GradingLevel[]) {
  if (row.grade_level != null) {
    const g = grades.find(x => x.grade === row.grade_level);
    return { text: `${row.weighted_score} · ${g ? g.name : 'грейд ' + row.grade_level}`, tone: 'ok' as const };
  }
  if (committeeSize > 0 && row.submitted_count > 0) {
    return { text: `идёт оценка ${row.submitted_count} из ${committeeSize}`, tone: 'warn' as const };
  }
  return { text: 'не начата', tone: 'neutral' as const };
}

/** Должности блока — не подразделения: одна «Техничка» на 20 цехов блока — одна строка. */
export function PositionsList({ rows, committeeSize, grades, onSelect, canSeeBreakdown, onShowBreakdown }: {
  rows: GradingPosition[];
  committeeSize: number;
  grades: GradingLevel[];
  onSelect: (row: GradingPosition) => void;
  /** Право «grading:blocks»/«grading:committee» — статус кликабелен, открывает разбивку по комиссии. */
  canSeeBreakdown?: boolean;
  onShowBreakdown?: (row: GradingPosition) => void;
}) {
  const { sorted, sortKey, sortDir, sortBy } = useSort(rows, (row, key) => {
    switch (key) {
      case 'title': return row.job_title;
      case 'units': return row.unit_count;
      case 'staff': return row.staff_count;
      case 'status': return statusOf(row, committeeSize, grades).text;
      default: return '';
    }
  });

  return (
    <div className={s.tableWrapFill}>
      <table className={s.table}>
        <thead>
          <tr>
            <SortTh label="Должность" sortKey="title" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
            <SortTh label="Подразделений" sortKey="units" activeKey={sortKey} dir={sortDir} onSort={sortBy} numeric className={s.num} />
            <SortTh label="Штат" sortKey="staff" activeKey={sortKey} dir={sortDir} onSort={sortBy} numeric className={s.num} />
            <SortTh label="Статус" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => {
            const st = statusOf(r, committeeSize, grades);
            const breakdownAvailable = canSeeBreakdown && committeeSize > 0 && (r.submitted_count > 0 || r.grade_level != null);
            return (
              <tr key={r.job_title} onClick={() => onSelect(r)}>
                <td><b>{r.job_title}</b></td>
                <td className={s.num} title={r.units.map(u => u.unit).join(', ')}>{r.unit_count}</td>
                <td className={s.num}>{r.staff_count}</td>
                <td>
                  {breakdownAvailable ? (
                    <button
                      type="button" className={s.statusBtn}
                      onClick={e => { e.stopPropagation(); onShowBreakdown!(r); }}
                      title="Показать, кто что выбрал"
                    >
                      <Badge tone={st.tone}>{st.text}</Badge>
                    </button>
                  ) : (
                    <Badge tone={st.tone}>{st.text}</Badge>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && <p className={s.empty}>В блоке нет должностей.</p>}
    </div>
  );
}
