import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { supportApi } from '../../api/support';
import { ApiError } from '../../api/client';
import { useToast } from '../../design/Toast';

const POLL_MS = 20000; // тот же интервал, что у поллинга старого клиента

/** Свои обращения сотрудника — список + открытая переписка + FAQ. */
export function useMySupport() {
  const toast = useToast();
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);

  const threadsQuery = useQuery({
    queryKey: ['my-support-threads'],
    queryFn: () => supportApi.myThreads(),
    refetchInterval: POLL_MS
  });
  const threads = threadsQuery.data?.rows ?? [];

  const threadQuery = useQuery({
    queryKey: ['my-support-thread', activeId],
    queryFn: () => supportApi.myThread(activeId as number),
    enabled: activeId != null,
    refetchInterval: POLL_MS
  });

  const faqQuery = useQuery({ queryKey: ['support-faq'], queryFn: () => supportApi.faq() });

  const startMutation = useMutation({
    mutationFn: ({ topic, text }: { topic: string; text: string }) => supportApi.start(topic, text),
    onSuccess: (r) => {
      setActiveId(r.id);
      void qc.invalidateQueries({ queryKey: ['my-support-threads'] });
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : 'Не удалось отправить обращение', 'error')
  });

  const replyMutation = useMutation({
    mutationFn: (text: string) => supportApi.reply(activeId as number, text),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-support-thread', activeId] });
      void qc.invalidateQueries({ queryKey: ['my-support-threads'] });
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : 'Не удалось отправить сообщение', 'error')
  });

  return {
    threads,
    threadsLoading: threadsQuery.isLoading,
    activeId, open: (id: number) => setActiveId(id), closeDetail: () => setActiveId(null),
    thread: threadQuery.data?.thread ?? null,
    messages: threadQuery.data?.messages ?? [],
    threadLoading: threadQuery.isLoading,
    faq: faqQuery.data?.rows ?? [],
    start: (topic: string, text: string) => startMutation.mutate({ topic, text }),
    starting: startMutation.isPending,
    reply: (text: string) => replyMutation.mutate(text),
    replying: replyMutation.isPending
  };
}
