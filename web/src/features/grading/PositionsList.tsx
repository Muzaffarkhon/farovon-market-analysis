import type { GradingLevel, GradingPosition } from '../../api/contract';
import { Badge } from '../../design/Badge';
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
export function PositionsList({ rows, committeeSize, grades, onSelect }: {
  rows: GradingPosition[];
  committeeSize: number;
  grades: GradingLevel[];
  onSelect: (row: GradingPosition) => void;
}) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Должность</th>
            <th className={s.num}>Подразделений</th>
            <th className={s.num}>Штат</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const st = statusOf(r, committeeSize, grades);
            return (
              <tr key={r.job_title} onClick={() => onSelect(r)}>
                <td><b>{r.job_title}</b></td>
                <td className={s.num} title={r.units.map(u => u.unit).join(', ')}>{r.unit_count}</td>
                <td className={s.num}>{r.staff_count}</td>
                <td><Badge tone={st.tone}>{st.text}</Badge></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && <p className={s.empty}>В блоке нет должностей.</p>}
    </div>
  );
}
