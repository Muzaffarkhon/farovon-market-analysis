import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { supportApi } from '../../../api/support';
import { ApiError } from '../../../api/client';
import { useToast } from '../../../design/Toast';
import type { SupportFilters } from '../../../api/contract';

const POLL_MS = 20000; // тот же интервал, что у supPollTick старого клиента

export function useSupportInbox() {
  const toast = useToast();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<SupportFilters>({});
  const [searchInput, setSearchInput] = useState('');
  const [activeId, setActiveId] = useState<number | null>(null);

  // Поиск уходит на сервер (кириллица не работает через SQL LIKE, см.
  // supportChatService.listThreads) — дебаунс, чтобы не слать запрос на
  // каждый символ.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters(f => (f.q === (searchInput || undefined) ? f : { ...f, q: searchInput || undefined }));
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const listQuery = useQuery({
    queryKey: ['support-inbox', filters],
    queryFn: () => supportApi.adminThreads(filters),
    refetchInterval: POLL_MS
  });

  const threadQuery = useQuery({
    queryKey: ['support-inbox-thread', activeId],
    queryFn: () => supportApi.adminThread(activeId as number),
    enabled: activeId != null,
    refetchInterval: POLL_MS
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['support-inbox'] });
    if (activeId != null) void qc.invalidateQueries({ queryKey: ['support-inbox-thread', activeId] });
  };
  const onError = (e: unknown, fallback: string) => toast.show(e instanceof ApiError ? e.message : fallback, 'error');

  const replyMutation = useMutation({
    mutationFn: (text: string) => supportApi.adminReply(activeId as number, text),
    onSuccess: invalidate,
    onError: e => onError(e, 'Не удалось отправить ответ')
  });

  const closeMutation = useMutation({
    mutationFn: () => supportApi.close(activeId as number),
    onSuccess: () => { invalidate(); toast.show('Диалог закрыт', 'ok'); },
    onError: e => onError(e, 'Не удалось закрыть диалог')
  });

  return {
    threads: listQuery.data?.rows ?? [],
    threadsLoading: listQuery.isLoading,
    threadsError: listQuery.error as Error | null,

    filters, setFilter: (patch: Partial<SupportFilters>) => setFilters(f => ({ ...f, ...patch })),
    resetFilters: () => { setFilters({}); setSearchInput(''); },
    searchInput, setSearchInput,
    active: !!(filters.q || filters.status || filters.reply || filters.login || filters.unread),

    activeId, open: (id: number) => setActiveId(id), closeDetail: () => setActiveId(null),
    thread: threadQuery.data?.thread ?? null,
    messages: threadQuery.data?.messages ?? [],
    threadLoading: threadQuery.isLoading,

    reply: (text: string) => replyMutation.mutate(text), replying: replyMutation.isPending,
    close: () => closeMutation.mutate(), closing: closeMutation.isPending,

    invalidate
  };
}
