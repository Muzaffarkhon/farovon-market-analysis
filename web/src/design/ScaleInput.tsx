import s from './ScaleInput.module.css';

/**
 * Шкала 1–5 для анкеты грейдирования (мокап `06-grading.html`): пять
 * кнопок-вариантов, под выбранной — пояснение и, если задан, пример
 * эталонной должности (калибрует экспертов между собой — ТЗ, раздел 6).
 * Анкета риска эталонов не показывает (у неё их нет) — `examples` тогда
 * просто не передаётся.
 */
export function ScaleInput({ label, value, onChange, options, examples }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  options: string[];
  examples?: string[];
}) {
  return (
    <div className={s.field}>
      <div className={s.head}>
        <span className={s.label}>{label}</span>
        <span className={s.value}>{value ? `${value} из ${options.length}` : '— не выбрано —'}</span>
      </div>
      <div className={s.row}>
        {options.map((_, i) => {
          const n = i + 1;
          return (
            <button
              key={n} type="button"
              className={[s.cell, value === n ? s.active : ''].join(' ')}
              aria-pressed={value === n}
              onClick={() => onChange(n)}
            >
              {n}
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
