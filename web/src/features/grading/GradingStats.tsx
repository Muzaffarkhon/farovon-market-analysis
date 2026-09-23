import { useQuery } from '@tanstack/react-query';
import { gradingApi } from '../../api/grading';
import type { GradingBlock } from '../../api/contract';
import { Skeleton } from '../../design/Skeleton';
import s from './Grading.module.css';

/** Распределение оценённых должностей по пяти группам (грейдам), блок × грейд. */
export function GradingStats({ blocks }: { blocks: GradingBlock[] }) {
  const stats = useQuery({ queryKey: ['grading-stats'], queryFn: () => gradingApi.stats() });
  const grades = useQuery({ queryKey: ['grading-factors-default'], queryFn: () => gradingApi.factors() });

  if (stats.isLoading || grades.isLoading) return <Skeleton lines={4} />;
  if (stats.error || grades.error) return <p className={s.empty}>Не удалось загрузить сводку.</p>;
  if (!stats.data || !grades.data) return null;
  const { rows, total } = stats.data;
  const { grades: gradeList } = grades.data;

  const countOf = (blockKey: string, grade: number) =>
    rows.find(r => r.block_key === blockKey && r.grade_level === grade)?.n ?? 0;

  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Блок</th>
            {gradeList.map(g => <th key={g.grade} className={s.num}>{g.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {blocks.map(b => (
            <tr key={b.key}>
              <td><b>{b.label}</b></td>
              {gradeList.map(g => <td key={g.grade} className={s.num}>{countOf(b.key, g.grade) || '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={s.empty} style={{ padding: 'var(--s-3)' }}>Оценено всего: {total}</p>
    </div>
  );
}
