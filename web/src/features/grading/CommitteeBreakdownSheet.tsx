import { useQuery } from '@tanstack/react-query';
import type { GradingFactor } from '../../api/contract';
import { gradingApi } from '../../api/grading';
import { Skeleton } from '../../design/Skeleton';
import { Sheet } from '../../design/Sheet';
import s from './Grading.module.css';

const FACTOR_KEYS = ['factor_1', 'factor_2', 'factor_3', 'factor_4', 'factor_5', 'factor_6', 'factor_7'] as const;

function avg(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * «Карточка сравнения»: по каждому вопросу — какой вариант выбрал каждый
 * член комиссии (текстом, не баллом — так же читаемо, как сама анкета) и
 * средний балл вопроса. Открывается по клику на статус должности — только
 * у тех, кто управляет блоками/комиссией: до итога это чужие голоса.
 */
export function CommitteeBreakdownSheet({ block, jobTitle, criteria, onClose }: {
  block: string; jobTitle: string; criteria: GradingFactor[]; onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ['grading-committee-breakdown', block, jobTitle],
    queryFn: () => gradingApi.committeeBreakdown({ block, job_title: jobTitle })
  });

  return (
    <Sheet open onClose={onClose} title={`Разбивка по комиссии — ${jobTitle}`} variant="modal">
      {q.isLoading && <Skeleton lines={6} />}
      {q.error && <p className={s.empty}>{(q.error as Error).message}</p>}
      {q.data && (
        <div className={s.form}>
          {!q.data.submissions.length && <p className={s.empty}>Заявок пока нет.</p>}
          {q.data.finalized && q.data.final && (
            <p className={s.locked}>
              Итог утверждён: {q.data.final.weighted_score} балла, грейд {q.data.final.grade_level}. {q.data.final.evaluated_by}
            </p>
          )}
          {criteria.map((c, i) => {
            const key = FACTOR_KEYS[i];
            const values = q.data!.submissions.map(sub => sub[key]);
            return (
              <div key={c.code} className={s.breakdownItem}>
                <div className={s.breakdownHead}>
                  <span>{c.code}. {c.title}</span>
                  <b>среднее {avg(values).toFixed(2)}</b>
                </div>
                <ul className={s.breakdownList}>
                  {q.data!.submissions.map(sub => (
                    <li key={sub.evaluator_login}>
                      <b>{sub.evaluator_fio}:</b> {c.options[sub[key] - 1] ?? sub[key]}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
