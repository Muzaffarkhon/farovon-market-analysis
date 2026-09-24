import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../../api/admin';
import { Badge } from '../../../design/Badge';
import { useConfirm } from '../../../design/Confirm';
import { Input } from '../../../design/Input';
import type { SupportThread } from '../../../api/contract';
import s from './SupportInbox.module.css';

/**
 * Поиск сотрудника по ФИО среди активных пользователей (та же выборка,
 * что уже загружает раздел «Пользователи», — фильтруется в браузере, как
 * и в старом клиенте: список умеренного размера, отдельный
 * search-эндпоинт не оправдан).
 */
export function LinkEmployeePanel({ thread, onLink, linking }: {
  thread: SupportThread; onLink: (userId: number) => void; linking: boolean;
}) {
  const [q, setQ] = useState('');
  const confirm = useConfirm();
  const usersQuery = useQuery({ queryKey: ['admin-users-for-link'], queryFn: () => adminApi.users() });
  const users = (usersQuery.data?.users ?? []).filter(u => u.active);
  const needle = q.trim().toLowerCase();
  const matches = (needle ? users.filter(u => u.fio.toLowerCase().includes(needle)) : users).slice(0, 30);

  return (
    <div>
      <Input label="" aria-label="Поиск сотрудника по ФИО" placeholder="Поиск сотрудника по ФИО…" value={q} onChange={e => setQ(e.target.value)} />
      <div className={s.list} style={{ marginTop: 'var(--s-2)', maxHeight: '40vh', overflowY: 'auto' }}>
        {matches.map(u => (
          <button
            key={u.id} type="button" className={s.row} disabled={linking}
            onClick={async () => {
              const warn = u.hasTelegram ? ' У сотрудника уже привязан другой Telegram — он будет отвязан.' : '';
              const phoneNote = thread.phone ? `, номер в карточке обновится на ${thread.phone}` : '';
              if (await confirm(`Привязать чат к «${u.fio}»${phoneNote}?${warn}`)) onLink(u.id);
            }}
          >
            <div className={s.rowTop}>
              <span className={s.rowName}>{u.fio}</span>
              {u.hasTelegram && <Badge tone="warn">Telegram уже привязан</Badge>}
            </div>
            <div className={s.rowMeta}>{u.phone || 'номер не указан'}</div>
          </button>
        ))}
        {!matches.length && <p className={s.empty}>Никого не найдено.</p>}
      </div>
    </div>
  );
}
