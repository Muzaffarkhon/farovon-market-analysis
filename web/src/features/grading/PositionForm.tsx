import { useState } from 'react';
import type { GradingFactor, GradingPosition } from '../../api/contract';
import { Button } from '../../design/Button';
import { useConfirm } from '../../design/Confirm';
import { ScaleInput } from '../../design/ScaleInput';
import { Sheet } from '../../design/Sheet';
import { Textarea } from '../../design/Textarea';
import s from './Grading.module.css';

/** Уже утверждено комиссией — форма недоступна на запись (сервер и так откажет 409, но не заставляем узнавать об этом через ошибку). */
function isLocked(row: GradingPosition, committeeSize: number) {
  return committeeSize > 0 && row.grade_level != null;
}

/**
 * Анкета из семи факторов. Ответы никогда не подставляются заранее — ни
 * прежняя утверждённая оценка, ни своя незавершённая заявка: пока эксперт
 * сам не нажал букву, анкета выглядит пустой, а не «за него уже выбрано».
 * Комментарий — единственное, что имеет смысл вспомнить и предзаполнить.
 */
export function PositionForm({
  row, criteria, committeeSize, onClose, onSubmit, submitting,
  canManage = false, onReset, resetting = false, onRestore, restoring = false
}: {
  row: GradingPosition;
  criteria: GradingFactor[];
  committeeSize: number;
  onClose: () => void;
  onSubmit: (a: { jobTitle: string; factors: number[]; notes?: string }) => void;
  submitting: boolean;
  /** Право «grading:blocks» (или роль admin) — управление оценкой прямо из карточки, без ухода в «Грейдирование — настройка». */
  canManage?: boolean;
  onReset?: () => void;
  resetting?: boolean;
  onRestore?: () => void;
  restoring?: boolean;
}) {
  const confirm = useConfirm();
  const initial = (row.my_submission || row) as unknown as Record<string, unknown>;
  const [values, setValues] = useState<number[]>(() => criteria.map(() => 0));
  const [notes, setNotes] = useState(String(initial.notes || ''));
  const locked = isLocked(row, committeeSize);
  const canSubmit = !locked && values.every(v => v > 0);

  return (
    <Sheet open onClose={onClose} title={row.job_title} variant="modal">
      {locked && (
        <p className={s.locked}>
          Оценка уже утверждена комиссией — изменить нельзя.{!canManage && ' Сброс — у администратора.'}
        </p>
      )}
      {canManage && (row.grade_level != null || row.has_reset_backup) && (
        <div className={s.formFoot} style={{ marginBottom: locked ? 0 : 'var(--s-3)' }}>
          {row.grade_level != null && (
            <Button
              variant="danger" size="sm" loading={resetting}
              onClick={async () => { if (onReset && await confirm({ message: `Сбросить оценку «${row.job_title}»? Действие можно отменить кнопкой «Восстановить».`, danger: true })) onReset(); }}
            >
              Сбросить оценку
            </Button>
          )}
          {row.has_reset_backup && (
            <Button
              variant="secondary" size="sm" loading={restoring}
              onClick={async () => { if (onRestore && await confirm(`Восстановить последнюю сброшенную оценку «${row.job_title}»?`)) onRestore(); }}
            >
              Восстановить оценку
            </Button>
          )}
        </div>
      )}
      {!locked && (
        <div className={s.form}>
          {criteria.map((c, i) => (
            <ScaleInput
              key={c.code}
              label={c.title}
              value={values[i]}
              onChange={v => setValues(prev => prev.map((x, j) => (j === i ? v : x)))}
              options={c.options}
              examples={c.examples}
            />
          ))}
          <Textarea label="Комментарий" value={notes} onChange={e => setNotes(e.target.value)} />
          <div className={s.formFoot}>
            <Button
              loading={submitting} disabled={!canSubmit}
              onClick={() => onSubmit({ jobTitle: row.job_title, factors: values, notes })}
            >
              Отправить оценку
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
