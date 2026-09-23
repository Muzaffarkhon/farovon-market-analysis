import { useState } from 'react';
import { Button } from '../../design/Button';
import { Input } from '../../design/Input';
import { Skeleton } from '../../design/Skeleton';
import { Textarea } from '../../design/Textarea';
import { useScreenTitle } from '../shell/Shell';
import { useMySupport } from './useMySupport';
import s from './Support.module.css';

function shortDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function StartForm({ onStart, submitting }: { onStart: (topic: string, text: string) => void; submitting: boolean }) {
  const [topic, setTopic] = useState('');
  const [text, setText] = useState('');
  return (
    <form
      className={s.form}
      onSubmit={e => { e.preventDefault(); if (topic.trim() && text.trim()) onStart(topic.trim(), text.trim()); }}
    >
      <Input label="Тема обращения" value={topic} maxLength={100} onChange={e => setTopic(e.target.value)} required />
      <Textarea label="Опишите вопрос" value={text} maxLength={2000} onChange={e => setText(e.target.value)} required rows={5} />
      <Button type="submit" loading={submitting} disabled={!topic.trim() || !text.trim()}>Отправить</Button>
    </form>
  );
}

function ThreadDetail({ m }: { m: ReturnType<typeof useMySupport> }) {
  const [text, setText] = useState('');
  if (m.threadLoading || !m.thread) return <Skeleton lines={4} />;
  return (
    <div className={s.thread}>
      <div className={s.head}>
        <div>
          <div className={s.threadTopic}>{m.thread.topic || 'Обращение'}</div>
          <div className={s.threadMeta}>{m.thread.status === 'open' ? 'Открыт' : 'Закрыт'}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={m.closeDetail}>← К списку</Button>
      </div>
      <div className={s.messages}>
        {m.messages.map(msg => (
          <div key={msg.id} className={[s.msg, msg.direction === 'out' ? s.msgOut : s.msgIn].join(' ')}>
            {msg.body}
            <div className={s.msgMeta}>{shortDate(msg.created_at)}</div>
          </div>
        ))}
        {!m.messages.length && <p className={s.empty}>Сообщений пока нет.</p>}
      </div>
      <div className={s.replyRow}>
        <Textarea
          label="" aria-label="Ваш ответ" value={text} maxLength={2000} rows={2}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (text.trim()) { m.reply(text.trim()); setText(''); }
            }
          }}
        />
        <Button
          loading={m.replying} disabled={!text.trim()}
          onClick={() => { if (text.trim()) { m.reply(text.trim()); setText(''); } }}
        >
          Отправить
        </Button>
      </div>
    </div>
  );
}

function FaqList({ items }: { items: { id: number; question: string; answer: string }[] }) {
  const [openId, setOpenId] = useState<number | null>(null);
  if (!items.length) return null;
  return (
    <div className={s.faq}>
      <h3>Частые вопросы</h3>
      {items.map(f => (
        <div key={f.id} className={s.faqItem}>
          <div className={s.faqQ} onClick={() => setOpenId(openId === f.id ? null : f.id)}>{f.question}</div>
          {openId === f.id && <div className={s.faqA}>{f.answer}</div>}
        </div>
      ))}
    </div>
  );
}

export function SupportScreen() {
  useScreenTitle('Поддержка');
  const m = useMySupport();

  if (m.threadsLoading) return <Skeleton lines={4} />;

  if (m.activeId != null) return <ThreadDetail m={m} />;

  return (
    <div>
      {m.threads.length > 0 && (
        <div className={s.threadList}>
          {m.threads.map(t => (
            <button key={t.id} type="button" className={s.threadRow} onClick={() => m.open(t.id)}>
              <div className={s.threadTop}>
                <span className={s.threadTopic}>{t.topic || 'Обращение'}</span>
                <span className={s.threadMeta}>
                  {t.status === 'open' ? 'Открыт' : 'Закрыт'}
                  {t.unread_count > 0 ? ` · новых: ${t.unread_count}` : ''}
                </span>
              </div>
              {t.last_body && <div className={s.threadPreview}>{t.last_body}</div>}
            </button>
          ))}
        </div>
      )}
      {!m.threads.length && <p className={s.empty}>Обращений пока нет.</p>}

      <h3 style={{ marginTop: 'var(--s-4)' }}>Написать в поддержку</h3>
      <StartForm onStart={m.start} submitting={m.starting} />

      <FaqList items={m.faq} />
    </div>
  );
}
