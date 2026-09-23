import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { coordinationApi } from '../../api/coordination';
import { ApiError } from '../../api/client';
import { useToast } from '../../design/Toast';

/**
 * Один запрос на весь экран — подразделения, люди и лента у координатора
 * почти всегда нужны вместе (см. спеку, раздел 4.3). Без фильтров: область
 * видимости уже сужена сервером по роли.
 */
export function useCoordination() {
  const toast = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const query = useQuery({ queryKey: ['coordination'], queryFn: () => coordinationApi.get() });

  const toggle = useCallback((login: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(login)) next.delete(login); else next.add(login);
      return next;
    });
  }, []);

  const remindMutation = useMutation({
    mutationFn: (logins: string[]) => coordinationApi.remind(logins),
    onSuccess: (r) => {
      toast.show(`Отправлено ${r.sent}, пропущено ${r.skipped} (нет Telegram или уже всё закрыто)`, r.sent > 0 ? 'ok' : 'info');
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['coordination'] });
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : 'Не удалось отправить напоминание', 'error')
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    selected, toggle,
    remind: () => remindMutation.mutate(Array.from(selected)),
    reminding: remindMutation.isPending
  };
}
