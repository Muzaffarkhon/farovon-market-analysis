import { useState } from 'react';
import type { SalaryRequest, SalaryStep } from '../../api/contract';
import { Button } from '../../design/Button';
import { useConfirm } from '../../design/Confirm';
import { Skeleton } from '../../design/Skeleton';
import { Textarea } from '../../design/Textarea';
import { useSalaryQueue } from './useSalary';
import s from './Salary.module.css';

const fmt = new Intl.NumberFormat('ru-RU');
const REASON_LABELS: Record<string, string> = {
  position_change: 'Переход на другую должность',
  probation_end: 'Выход из стажировки',
  individual_results: 'Индивидуальный подход',
  benchmark: 'Данные бенчмаркинга рынка',
  grading: 'Результат грейдирования',
  free_text: 'Другое'
};

function RequestCard({ row, onDecide, deciding }: {
  row: SalaryRequest;
  onDecide: (a: { id: number; decision: 'approved' | 'rejected'; comment?: string }) => void;
  deciding: boolean;
}) {
  const confirm = useConfirm();
  const [comment, setComment] = useState('');
  const up = row.proposedSalary > (row.currentSalary ?? 0);

  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <div>
          <div className={s.cardTitle}>{row.fio}</div>
          <div className={s.hint}>{row.unit}{row.position ? `, ${row.position}` : ''}</div>
        </div>
        <div className={[s.amount, up ? s.amountUp : ''].join(' ')}>
          {row.currentSalary != null ? fmt.format(row.currentSalary) : '—'} → <b>{fmt.format(row.proposedSalary)}</b>
          {row.proposedPercent ? ` (${row.proposedPercent > 0 ? '+' : ''}${row.proposedPercent}%)` : ''}
        </div>
      </div>
      <div className={s.hint}>{row.reasons.map(r => REASON_LABELS[r] ?? r).join(', ')}</div>
      {row.reasonText && <div>{row.reasonText}</div>}
      <div className={s.hint}>Подал: {row.createdBy} · {new Date(row.createdAt.replace(' ', 'T')).toLocaleString('ru-RU')}</div>

      <Textarea label="Комментарий (необязательно)" value={comment} onChange={e => setComment(e.target.value)} rows={2} />
      <div className={s.cardFoot}>
        <Button
          size="sm" variant="danger" loading={deciding}
          onClick={async () => {
            if (await confirm({ title: 'Отклонить заявку?', message: `Заявка на ${row.fio} будет отклонена, дальше по цепочке не пойдёт.`, okLabel: 'Отклонить', danger: true })) {
              onDecide({ id: row.id, decision: 'rejected', comment: comment.trim() || undefined });
            }
          }}
        >
          Отклонить
        </Button>
        <Button
          size="sm" loading={deciding}
          onClick={() => onDecide({ id: row.id, decision: 'approved', comment: comment.trim() || undefined })}
        >
          Согласовать
        </Button>
      </div>
    </div>
  );
}

export function RequestQueue({ step }: { step: SalaryStep }) {
  const q = useSalaryQueue(step);

  if (q.loading) return <Skeleton lines={4} />;
  if (!q.rows.length) return <p className={s.empty}>Нет заявок, ожидающих вашего решения</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      {q.rows.map(row => <RequestCard key={row.id} row={row} onDecide={q.decide} deciding={q.deciding} />)}
    </div>
  );
}
