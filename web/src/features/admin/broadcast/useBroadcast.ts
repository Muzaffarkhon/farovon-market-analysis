import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { broadcastApi } from '../../../api/broadcast';
import { ApiError } from '../../../api/client';
import { useToast } from '../../../design/Toast';

export function useBroadcast() {
  const toast = useToast();
  const qc = useQueryClient();

  const recipientsQuery = useQuery({ queryKey: ['broadcast-recipients'], queryFn: broadcastApi.recipients });
  const historyQuery = useQuery({ queryKey: ['broadcast-history'], queryFn: broadcastApi.list });

  const sendMutation = useMutation({
    mutationFn: broadcastApi.send,
    onSuccess: r => {
      toast.show(`Доставлено ${r.sent} из ${r.total}${r.failed ? `, не дошло: ${r.failed}` : ''}`, r.failed ? 'error' : 'ok');
      void qc.invalidateQueries({ queryKey: ['broadcast-history'] });
    },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось отправить рассылку', 'error')
  });

  return {
    recipients: recipientsQuery.data?.rows ?? [],
    totalActive: recipientsQuery.data?.totalActive ?? 0,
    recipientsLoading: recipientsQuery.isLoading,
    history: historyQuery.data?.rows ?? [],
    historyLoading: historyQuery.isLoading,
    send: sendMutation.mutate,
    sending: sendMutation.isPending
  };
}
