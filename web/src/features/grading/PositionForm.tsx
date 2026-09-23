import { useState } from 'react';
import type { GradingFactor, GradingPosition } from '../../api/contract';
import { Button } from '../../design/Button';
import { ScaleInput } from '../../design/ScaleInput';
import { Sheet } from '../../design/Sheet';
import { Textarea } from '../../design/Textarea';
import s from './Grading.module.css';

const FACTOR_KEYS = ['factor_1', 'factor_2', 'factor_3', 'factor_4', 'factor_5', 'factor_6', 'factor_7'] as const;

/** Уже утверждено комиссией — форма недоступна на запись (сервер и так откажет 409, но не заставляем узнавать об этом через ошибку). */
function isLocked(row: GradingPosition, committeeSize: number) {
  return committeeSize > 0 && row.grade_level != null;
}

/** Анкета из семи факторов. Черновик — своя слепая заявка, если уже сдавал, иначе прежняя утверждённая оценка, иначе пусто. */
export function PositionForm({ row, criteria, committeeSize, onClose, onSubmit, submitting }: {
  row: GradingPosition;
  criteria: GradingFactor[];
  committeeSize: number;
  onClose: () => void;
  onSubmit: (a: { jobTitle: string; factors: number[]; notes?: string }) => void;
  submitting: boolean;
}) {
  const initial = (row.my_submission || row) as unknown as Record<string, unknown>;
  // Ровно столько значений, сколько реально пришло факторов анкеты — не
  // жёстко семь: тест и любой другой набор критериев не должны требовать
  // заполнения несуществующих слотов, чтобы кнопка стала активной.
  const [values, setValues] = useState<number[]>(
    FACTOR_KEYS.slice(0, criteria.length).map(k => Number(initial[k]) || 0)
  );
  const [notes, setNotes] = useState(String(initial.notes || ''));
  const locked = isLocked(row, committeeSize);
  const canSubmit = !locked && values.every(v => v > 0);

  return (
    <Sheet open onClose={onClose} title={row.job_title}>
      {locked ? (
        <p className={s.locked}>Оценка уже утверждена комиссией — изменить нельзя. Сброс — у администратора.</p>
      ) : (
        <div className={s.form}>
          {criteria.map((c, i) => (
            <ScaleInput
              key={c.code}
              label={`${c.code}. ${c.title}`}
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
