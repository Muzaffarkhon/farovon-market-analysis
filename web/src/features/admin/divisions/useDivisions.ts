import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../../api/admin';
import { ApiError } from '../../../api/client';
import type {
  SaveDivisionPayload, CreateDivisionPayload, MoveDivisionPayload, BatchAssignPayload,
  ApplyAdjacentGroupPayload, ClearAdjacentGroupPayload
} from '../../../api/contract';
import { useToast } from '../../../design/Toast';

export function useDivisions() {
  const toast = useToast();
  const qc = useQueryClient();

  const divisions = useQuery({ queryKey: ['admin-divisions'], queryFn: () => adminApi.divisions() });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin-divisions'] });

  const save = useMutation({
    mutationFn: (p: SaveDivisionPayload) => adminApi.saveDivision(p),
    onSuccess: () => { toast.show('Подразделение обновлено', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось сохранить подразделение', 'error')
  });

  const create = useMutation({
    mutationFn: (p: CreateDivisionPayload) => adminApi.createDivision(p),
    onSuccess: r => { toast.show(r.message, 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось создать подразделение', 'error')
  });

  const move = useMutation({
    mutationFn: (p: MoveDivisionPayload) => adminApi.moveDivision(p),
    onSuccess: r => { toast.show(r.message, 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось переместить подразделение', 'error')
  });

  const hide = useMutation({
    mutationFn: (a: { unit: string; hidden: boolean }) => adminApi.hideDivision(a.unit, a.hidden),
    onSuccess: () => invalidate(),
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось изменить видимость', 'error')
  });

  const remove = useMutation({
    mutationFn: (unit: string) => adminApi.deleteDivision(unit),
    onSuccess: () => { toast.show('Подразделение удалено', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось удалить подразделение', 'error')
  });

  const batchAssign = useMutation({
    mutationFn: (p: BatchAssignPayload) => adminApi.batchAssign(p),
    onSuccess: r => { toast.show(r.message, 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось выполнить массовое назначение', 'error')
  });

  const applyAdjacentGroup = useMutation({
    mutationFn: (p: ApplyAdjacentGroupPayload) => adminApi.applyAdjacentGroup(p),
    onSuccess: r => { toast.show(`Объединено площадок: ${r.applied}`, 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось объединить в смежную группу', 'error')
  });

  const clearAdjacentGroup = useMutation({
    mutationFn: (p: ClearAdjacentGroupPayload) => adminApi.clearAdjacentGroup(p),
    onSuccess: () => { toast.show('Группа разъединена', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось разъединить группу', 'error')
  });

  return {
    divisions: divisions.data?.divisions, divisionsLoading: divisions.isLoading, divisionsError: divisions.error as Error | null,
    groupSuggestions: divisions.data?.groupSuggestions ?? [],
    save: save.mutate,
    create: create.mutate, creating: create.isPending,
    move: move.mutate,
    setHidden: hide.mutate,
    remove: remove.mutate,
    batchAssign: batchAssign.mutate, batchAssigning: batchAssign.isPending,
    applyAdjacentGroup: applyAdjacentGroup.mutate, applyingAdjacentGroup: applyAdjacentGroup.isPending,
    clearAdjacentGroup: clearAdjacentGroup.mutate
  };
}
