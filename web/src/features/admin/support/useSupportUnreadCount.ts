import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supportApi } from '../../../api/support';
import { useSessionData } from '../../auth/useSession';

const POLL_MS = 20000; // тот же интервал, что у опроса самого инбокса (useSupportInbox)

/**
 * Счётчик тредов поддержки с непрочитанным входящим сообщением — бейдж
 * рядом с карточкой «Чат поддержки» в администрировании, тот же приём, что
 * был в старом клиенте (client/app.js, refreshSupportUnreadBadge). Опрашивает
 * сервер сам, а не ждёт открытия инбокса — иначе бейдж не появился бы, пока
 * администратор туда не зайдёт.
 */
export function useSupportUnreadCount() {
  const { user } = useSessionData();
  const enabled = user.role === 'admin' || user.capabilities.includes('support:manage');
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['support-unread-count'],
    queryFn: () => supportApi.unreadCount(),
    enabled,
    refetchInterval: enabled ? POLL_MS : false
  });

  return {
    count: q.data?.count ?? 0,
    refresh: () => void qc.invalidateQueries({ queryKey: ['support-unread-count'] })
  };
}
