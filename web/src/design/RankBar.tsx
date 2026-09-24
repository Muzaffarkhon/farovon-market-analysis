import s from './RankBar.module.css';

/** Полоса рейтинга: подпись, процент справа, закрашенная полоса снизу — для льгот, топ-компаний, видов премии. */
export function RankBar({ label, pct, count, bold }: { label: string; pct: number; count?: number; bold?: boolean }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className={s.item}>
      <div className={s.head}>
        <span className={[s.label, bold ? s.labelBold : ''].join(' ')}>{label}</span>
        <b>{Math.round(pct)}%{count != null && <span className={s.count}> · {count}</span>}</b>
      </div>
      <div className={s.bar}><i style={{ width: `${clamped}%` }} /></div>
    </div>
  );
}
