import type { CoordinationFeedItem } from '../../api/contract';
import { shortDate } from '../registry/format';
import s from './Coordination.module.css';

/** Последние записи по видимым направлениям — просто «жив ли процесс», без ссылок и фильтров. */
export function ActivityFeed({ feed }: { feed: CoordinationFeedItem[] }) {
  return (
    <div className={s.column}>
      <h3 className={s.sectionTitle}>Последние записи</h3>
      {feed.map((f, i) => (
        <div key={i} className={s.feedRow}>
          <div><b>{f.company || '—'}</b> · {f.posOur || '—'}</div>
          <div className={s.feedMeta}>{f.unit}{f.by ? ` · ${f.by}` : ''} · {shortDate(f.at)}</div>
        </div>
      ))}
      {!feed.length && <p className={s.empty}>Пока ничего не внесено.</p>}
    </div>
  );
}
