import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { keyRisksApi } from '../../api/keyRisks';
import { ApiError } from '../../api/client';
import { useToast } from '../../design/Toast';
import { useSessionData } from '../auth/useSession';

const NO_DIR = '(без направления)';

/** Направление — в пути (`/key-risks/:dir?`), как блок в грейдировании: ссылку на направление можно переслать. */
export function useKeyRisks() {
  const { dir = '' } = useParams<{ dir?: string }>();
  const toast = useToast();
  const qc = useQueryClient();
  const { units } = useSessionData();

  const heatmap = useQuery({ queryKey: ['key-risks-heatmap'], queryFn: () => keyRisksApi.heatmap() });

  const dirUnits = useMemo(
    () => new Set(units.filter(u => (u.dir || NO_DIR) === dir).map(u => u.unit)),
    [units, dir]
  );
  // Тепловая карта уже посчитана на сервере по направлениям — для списка
  // сотрудников конкретного направления фильтруем весь (уже ограниченный
  // видимостью пользователя) список оценок на клиенте по составу юнитов.
  const allRisks = useQuery({
    queryKey: ['key-risks-list-all'],
    queryFn: () => keyRisksApi.list({}),
    enabled: !!dir
  });
  const dirRows = (allRisks.data?.rows ?? [])
    .filter(r => dirUnits.has(r.unit))
    .sort((a, b) => b.total_risk_score - a.total_risk_score);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['key-risks-heatmap'] });
    void qc.invalidateQueries({ queryKey: ['key-risks-list-all'] });
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

  return {
    dir,
    heatmap: heatmap.data?.rows,
    heatmapLoading: heatmap.isLoading,
    heatmapError: heatmap.error as Error | null,
    dirRows,
    dirRowsLoading: allRisks.isLoading,
    evaluate: evaluateMutation.mutate,
    evaluating: evaluateMutation.isPending,
    remove: deleteMutation.mutate
  };
}
