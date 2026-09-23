import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { keyRisksApi } from '../../api/keyRisks';
import { ApiError } from '../../api/client';
import { useToast } from '../../design/Toast';

/** Тепловая карта + список «Требуют внимания» — один экран, два запроса (разные формы данных, кэшировать вместе смысла нет). */
export function useKeyRisks() {
  const toast = useToast();
  const qc = useQueryClient();

  const heatmap = useQuery({ queryKey: ['key-risks-heatmap'], queryFn: () => keyRisksApi.heatmap() });
  // «Требуют внимания» — attention и critical вместе, сервер фильтрует по одному
  // статусу за раз, поэтому две страницы объединяются на клиенте.
  const attention = useQuery({ queryKey: ['key-risks-list', 'attention'], queryFn: () => keyRisksApi.list({ status: 'attention' }) });
  const critical = useQuery({ queryKey: ['key-risks-list', 'critical'], queryFn: () => keyRisksApi.list({ status: 'critical' }) });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['key-risks-heatmap'] });
    void qc.invalidateQueries({ queryKey: ['key-risks-list'] });
  };

  const evaluateMutation = useMutation({
    mutationFn: keyRisksApi.evaluate,
    onSuccess: (r) => { toast.show(r.message, 'ok'); invalidate(); },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : 'Не удалось сохранить оценку', 'error')
  });

  const deleteMutation = useMutation({
    mutationFn: keyRisksApi.delete,
    onSuccess: () => { toast.show('Оценка удалена', 'ok'); invalidate(); },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : 'Не удалось удалить оценку', 'error')
  });

  const rows = [...(attention.data?.rows ?? []), ...(critical.data?.rows ?? [])]
    .sort((a, b) => b.total_risk_score - a.total_risk_score);

  return {
    heatmap: heatmap.data?.rows,
    heatmapLoading: heatmap.isLoading,
    heatmapError: heatmap.error as Error | null,
    rows,
    rowsLoading: attention.isLoading || critical.isLoading,
    evaluate: evaluateMutation.mutate,
    evaluating: evaluateMutation.isPending,
    remove: deleteMutation.mutate
  };
}
