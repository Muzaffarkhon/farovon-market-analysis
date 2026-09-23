import type { SupportThreadListItem } from '../../../api/contract';
import { Badge } from '../../../design/Badge';
import s from './SupportInbox.module.css';

function shortDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function displayName(t: SupportThreadListItem) {
  if (t.linked_fio) return t.linked_fio;
  return t.source === 'web' ? `Сотрудник #${t.id}` : `Гость #${t.id}`;
}

export function ThreadList({ threads, onOpen }: { threads: SupportThreadListItem[]; onOpen: (id: number) => void }) {
  if (!threads.length) return <p className={s.empty}>Обращений не найдено.</p>;
  return (
    <div className={s.list}>
      {threads.map(t => (
        <button key={t.id} type="button" className={s.row} onClick={() => onOpen(t.id)}>
          <div className={s.rowTop}>
            <span className={s.rowName}>{displayName(t)}</span>
            <span className={s.rowMeta}>{shortDate(t.last_message_at)}</span>
          </div>
          {t.last_body && <div className={s.rowPreview}>{t.last_body}</div>}
          <div className={s.rowTags}>
            <Badge tone="neutral">{t.source === 'web' ? 'сайт' : 'Telegram'}</Badge>
            {t.topic && <Badge tone="neutral">{t.topic}</Badge>}
            {t.status === 'closed' && <Badge tone="muted">закрыт</Badge>}
            {t.source !== 'web' && !t.linked_fio && <Badge tone="warn">нет привязки</Badge>}
            {t.unread_count > 0 && <Badge tone="ok">новых: {t.unread_count}</Badge>}
          </div>
        </button>
      ))}
    </div>
  );
}
