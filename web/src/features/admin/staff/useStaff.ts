import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../../api/admin';
import { ApiError } from '../../../api/client';
import type { SaveStaffPayload } from '../../../api/contract';
import { useToast } from '../../../design/Toast';

export function useStaff() {
  const toast = useToast();
  const qc = useQueryClient();

  const list = useQuery({ queryKey: ['admin-staff-directory'], queryFn: () => adminApi.staffDirectory() });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin-staff-directory'] });

  const save = useMutation({
    mutationFn: (p: SaveStaffPayload) => adminApi.saveStaffRecord(p),
    onSuccess: () => { toast.show('Запись сохранена', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось сохранить запись', 'error')
  });

  const remove = useMutation({
    mutationFn: (id: number) => adminApi.deleteStaffRecord(id),
    onSuccess: () => { toast.show('Запись удалена', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось удалить запись', 'error')
  });

  const dryRun = useMutation({
    mutationFn: (csv: string) => adminApi.importStaffDirectoryDryRun(csv),
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось разобрать файл', 'error')
  });

  const commit = useMutation({
    mutationFn: (csv: string) => adminApi.importStaffDirectoryCommit(csv),
    onSuccess: r => { toast.show(r.message, 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось импортировать', 'error')
  });

  return {
    items: list.data?.items, importedAt: list.data?.importedAt, listLoading: list.isLoading, listError: list.error as Error | null,
    save: save.mutate,
    remove: remove.mutate,
    dryRun: dryRun.mutateAsync, dryRunResult: dryRun.data, dryRunPending: dryRun.isPending, resetDryRun: dryRun.reset,
    commit: commit.mutate, committing: commit.isPending
  };
}
