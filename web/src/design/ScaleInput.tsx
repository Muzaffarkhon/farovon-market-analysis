import { useState } from 'react';
import s from './ScaleInput.module.css';

const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

/** Перетасовка Фишера — Йетса: какой вариант (0-based) окажется под какой буквой. */
function shuffledOrder(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * Шкала 1–5 для анкеты грейдирования (мокап `06-grading.html`): пять
 * кнопок-вариантов, под выбранной — пояснение и, если задан, пример
 * эталонной должности (калибрует экспертов между собой — ТЗ, раздел 6).
 * Анкета риска эталонов не показывает (у неё их нет) — `examples` тогда
 * просто не передаётся.
 *
 * Кнопки подписаны буквами, а не баллом, и вариант под каждой буквой
 * перемешивается заново при каждом открытии карточки: позиция и подпись
 * ничего не говорят о выставленном балле, поэтому его не выдаёт ни экран
 * через плечо, ни фраза «я поставил третий вариант» до подведения итога
 * комиссией.
 */
export function ScaleInput({ label, value, onChange, options, examples }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  options: string[];
  examples?: string[];
}) {
  const [order] = useState(() => shuffledOrder(options.length));
  const selectedLetter = value > 0 ? LETTERS[order.indexOf(value - 1)] : null;

  return (
    <div className={s.field}>
      <div className={s.head}>
        <span className={s.label}>{label}</span>
        <span className={s.value}>{selectedLetter ? `выбран вариант ${selectedLetter}` : '— не выбрано —'}</span>
      </div>
      <div className={s.row}>
        {order.map((optIndex, col) => {
          const score = optIndex + 1;
          return (
            <button
              key={optIndex} type="button"
              className={[s.cell, value === score ? s.active : ''].join(' ')}
              aria-pressed={value === score}
              onClick={() => onChange(value === score ? 0 : score)}
            >
              {LETTERS[col]}
            </button>
          );
        })}
      </div>
      {value > 0 && (
        <p className={s.hint}>
          {options[value - 1]}
          {examples && examples[value - 1] && <><br /><i>Например: {examples[value - 1]}</i></>}
        </p>
      )}
    </div>
  );
}
