import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { periodsApi } from '../../../api/periods';
import { ApiError } from '../../../api/client';
import type { SetPeriodPayload } from '../../../api/contract';
import { useToast } from '../../../design/Toast';

export function usePeriods() {
  const toast = useToast();
  const qc = useQueryClient();

  const list = useQuery({ queryKey: ['admin-periods'], queryFn: () => periodsApi.list() });
  const grantUsers = useQuery({ queryKey: ['admin-period-grant-users'], queryFn: () => periodsApi.grantUsers() });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin-periods'] });

  const setPeriod = useMutation({
    mutationFn: (p: SetPeriodPayload) => periodsApi.setPeriod(p),
    onSuccess: () => { toast.show('Период обновлён', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось изменить период', 'error')
  });

  const remove = useMutation({
    mutationFn: (periodId: number) => periodsApi.deletePeriod(periodId),
    onSuccess: () => { toast.show('Период удалён', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось удалить период', 'error')
  });

  const grant = useMutation({
    mutationFn: (a: { userLogin: string; periodId: number }) => periodsApi.grant(a.userLogin, a.periodId),
    onSuccess: () => { toast.show('Доступ выдан на сутки', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось выдать доступ', 'error')
  });

  const revokeGrant = useMutation({
    mutationFn: (a: { userLogin: string; periodId: number }) => periodsApi.revokeGrant(a.userLogin, a.periodId),
    onSuccess: () => { toast.show('Доступ отозван', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось отозвать доступ', 'error')
  });

  return {
    periods: list.data?.periods, grants: list.data?.grants, loading: list.isLoading, error: list.error as Error | null,
    grantUsers: grantUsers.data?.users,
    setPeriod: setPeriod.mutate,
    remove: remove.mutate,
    grant: grant.mutate,
    revokeGrant: revokeGrant.mutate
  };
}
