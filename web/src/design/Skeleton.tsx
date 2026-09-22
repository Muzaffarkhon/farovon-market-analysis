import s from './Skeleton.module.css';

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className={s.wrap} aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: lines }, (_, i) => <div key={i} className={s.line} style={{ width: `${70 + ((i * 13) % 30)}%` }} />)}
    </div>
  );
}
