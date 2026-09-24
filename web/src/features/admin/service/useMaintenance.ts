import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { maintenanceApi } from '../../../api/maintenance';
import { ApiError } from '../../../api/client';
import { useConfirm } from '../../../design/Confirm';
import { useToast } from '../../../design/Toast';

export function useMaintenance() {
  const toast = useToast();
  const qc = useQueryClient();
  const confirm = useConfirm();

  const status = useQuery({ queryKey: ['data-status'], queryFn: maintenanceApi.dataStatus });
  const locks = useQuery({ queryKey: ['locks'], queryFn: maintenanceApi.getLocks, enabled: false });

  const invalidateStatus = () => void qc.invalidateQueries({ queryKey: ['data-status'] });

  const simpleTask = useMutation({
    mutationFn: (taskType: string) => maintenanceApi.runTask(taskType),
    onSuccess: r => { toast.show(r.message, 'ok'); invalidateStatus(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось выполнить задачу', 'error')
  });

  const unlock = useMutation({
    mutationFn: (a: { targetOwner?: string; targetRole?: string }) => maintenanceApi.unlock(a),
    onSuccess: r => { toast.show(r.message, 'ok'); void qc.invalidateQueries({ queryKey: ['locks'] }); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось снять блокировки', 'error')
  });

  /**
   * distribute_companies/undo_distribute — единственные задачи, которые сначала
   * молча считают объём и возвращают {needsConfirm:true, total, message} вместо
   * выполнения (см. runMaintenance на сервере) — второй вызов с confirm:true
   * уже делает дело. ApiError.raw несёт этот объект первого ответа.
   */
  async function runDistribute(taskType: 'distribute_companies' | 'undo_distribute') {
    try {
      const r = await maintenanceApi.runTask(taskType);
      toast.show(r.message, 'ok');
      invalidateStatus();
    } catch (e) {
      const needsConfirm = e instanceof ApiError && (e.raw as { needsConfirm?: boolean } | undefined)?.needsConfirm;
      if (!needsConfirm) {
        toast.show(e instanceof ApiError ? e.message : 'Не удалось выполнить задачу', 'error');
        return;
      }
      const ok = await confirm({ title: 'Подтверждение', message: (e as ApiError).message, okLabel: 'Выполнить', danger: true });
      if (!ok) return;
      try {
        const r2 = await maintenanceApi.runTask(taskType, { confirm: true });
        toast.show(r2.message, 'ok');
        invalidateStatus();
      } catch (e2) {
        toast.show(e2 instanceof ApiError ? e2.message : 'Не удалось выполнить задачу', 'error');
      }
    }
  }

  return {
    status: status.data?.status, statusLoading: status.isLoading, statusError: status.error as Error | null,
    refetchStatus: () => void status.refetch(),
    runSimple: simpleTask.mutate, runningTask: simpleTask.isPending,
    runDistribute,
    locks: locks.data?.locks, locksLoading: locks.isFetching, loadLocks: () => void locks.refetch(),
    unlock: unlock.mutate, unlocking: unlock.isPending
  };
}
