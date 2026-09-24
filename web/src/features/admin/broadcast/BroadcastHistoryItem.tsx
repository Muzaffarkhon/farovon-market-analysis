import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { broadcastApi } from '../../../api/broadcast';
import type { BroadcastListItem } from '../../../api/contract';
import { Skeleton } from '../../../design/Skeleton';
import s from '../Admin.module.css';

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function BroadcastHistoryItem({ item }: { item: BroadcastListItem }) {
  const [open, setOpen] = useState(false);
  const detailsQuery = useQuery({
    queryKey: ['broadcast-details', item.id],
    queryFn: () => broadcastApi.details(item.id),
    enabled: open
  });

  return (
    <div className={s.unitRow} style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'pointer' }} onClick={() => setOpen(v => !v)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s-2)' }}>
        <span>#{item.id} · {fmtDateTime(item.created_at)} · {item.author_login}</span>
        <span className={s.hint}>
          Доставлено {item.sent} из {item.total}{item.failed ? `, не дошло: ${item.failed}` : ''}
        </span>
      </div>
      <div className={s.hint}>{item.body}</div>
      {open && (
        <div style={{ marginTop: 'var(--s-2)' }} onClick={e => e.stopPropagation()}>
          {detailsQuery.isLoading && <Skeleton lines={2} />}
          {detailsQuery.data && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-2)' }}>
              {detailsQuery.data.recipients.map(r => (
                <span key={r.fio} className={s.hint} style={{ color: r.status === 'sent' ? undefined : 'var(--danger)' }}>
                  {r.fio}{r.status === 'sent' ? '' : ' — не доставлено'}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
