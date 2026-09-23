import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supportApi } from '../../../api/support';
import { ApiError } from '../../../api/client';
import { useToast } from '../../../design/Toast';

/** Готовые фразы (обе аудитории), FAQ — настройка раздела «Чат поддержки». */
export function useSupportSettings() {
  const toast = useToast();
  const qc = useQueryClient();
  const onError = (e: unknown, fallback: string) => toast.show(e instanceof ApiError ? e.message : fallback, 'error');

  const adminRepliesQuery = useQuery({ queryKey: ['support-quick-replies', 'admin'], queryFn: () => supportApi.quickReplies('admin') });
  const guestRepliesQuery = useQuery({ queryKey: ['support-quick-replies', 'guest'], queryFn: () => supportApi.quickReplies('guest') });
  const faqQuery = useQuery({ queryKey: ['support-faq-admin'], queryFn: () => supportApi.faq() });

  const saveReplyMutation = useMutation({
    mutationFn: supportApi.saveQuickReply,
    onSuccess: (_r, vars) => void qc.invalidateQueries({ queryKey: ['support-quick-replies', vars.audience] }),
    onError: e => onError(e, 'Не удалось сохранить фразу')
  });
  const deleteReplyMutation = useMutation({
    mutationFn: ({ id }: { id: number; audience: 'admin' | 'guest' }) => supportApi.deleteQuickReply(id),
    onSuccess: (_r, vars) => void qc.invalidateQueries({ queryKey: ['support-quick-replies', vars.audience] }),
    onError: e => onError(e, 'Не удалось удалить фразу')
  });

  const saveFaqMutation = useMutation({
    mutationFn: supportApi.saveFaq,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['support-faq-admin'] }),
    onError: e => onError(e, 'Не удалось сохранить вопрос')
  });
  const deleteFaqMutation = useMutation({
    mutationFn: (id: number) => supportApi.deleteFaq(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['support-faq-admin'] }),
    onError: e => onError(e, 'Не удалось удалить вопрос')
  });

  return {
    adminReplies: adminRepliesQuery.data?.rows ?? [],
    guestReplies: guestRepliesQuery.data?.rows ?? [],
    faq: faqQuery.data?.rows ?? [],
    saveReply: saveReplyMutation.mutate, savingReply: saveReplyMutation.isPending,
    deleteReply: deleteReplyMutation.mutate,
    saveFaq: saveFaqMutation.mutate, savingFaq: saveFaqMutation.isPending,
    deleteFaq: deleteFaqMutation.mutate
  };
}
