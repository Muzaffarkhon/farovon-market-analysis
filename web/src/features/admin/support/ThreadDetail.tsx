import { useState } from 'react';
import { Badge } from '../../../design/Badge';
import { Button } from '../../../design/Button';
import { Sheet } from '../../../design/Sheet';
import { Skeleton } from '../../../design/Skeleton';
import { Textarea } from '../../../design/Textarea';
import type { useSupportInbox } from './useSupportInbox';
import s from './SupportInbox.module.css';

function shortDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Детали треда — шторка сбоку по клику на строку (как в реестре, см. RecordSheet). */
export function ThreadDetail({ inbox }: { inbox: ReturnType<typeof useSupportInbox> }) {
  const [text, setText] = useState('');
  const open = inbox.activeId != null;
  const t = inbox.thread;

  const send = () => { if (text.trim()) { inbox.reply(text.trim()); setText(''); } };

  return (
    <Sheet open={open} onClose={inbox.closeDetail} title={t?.topic || (t?.linked_fio ?? 'Обращение')}>
      {inbox.threadLoading || !t ? <Skeleton lines={4} /> : (
        <div>
          <div className={s.detailHead}>
            <div>
              <div>{t.linked_fio || (t.source === 'web' ? `Сотрудник #${t.id}` : `Гость #${t.id}`)}</div>
              {t.phone && <div className={s.rowMeta}>{t.phone}</div>}
              <Badge tone={t.status === 'open' ? 'ok' : 'muted'}>{t.status === 'open' ? 'Открыт' : 'Закрыт'}</Badge>
            </div>
            <div className={s.detailActions}>
              {t.status === 'open' && (
                <Button size="sm" variant="secondary" loading={inbox.closing} onClick={inbox.close}>Закрыть</Button>
              )}
            </div>
          </div>

          <div className={s.messages}>
            {inbox.messages.map(m => (
              <div key={m.id} className={[s.msg, m.direction === 'out' ? s.msgOut : s.msgIn].join(' ')}>
                {m.body}
                <div className={s.msgMeta}>{shortDate(m.created_at)}{m.author_login ? ` · ${m.author_login}` : ''}</div>
              </div>
            ))}
            {!inbox.messages.length && <p className={s.empty}>Сообщений пока нет.</p>}
          </div>

          <div className={s.replyRow}>
            <Textarea
              label="" aria-label="Ответ" value={text} rows={2}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <Button loading={inbox.replying} disabled={!text.trim()} onClick={send}>Отправить</Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
