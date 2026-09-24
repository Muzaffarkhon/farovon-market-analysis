import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../../api/admin';
import { gradingApi } from '../../../api/grading';
import { ApiError } from '../../../api/client';
import type { GradingFactorScope, SaveFactorPayload } from '../../../api/contract';
import { useToast } from '../../../design/Toast';

export function useAdminBlocks() {
  return useQuery({ queryKey: ['admin-grading-blocks'], queryFn: () => gradingApi.adminBlocks() });
}

export function useFactorsAdmin(scope: GradingFactorScope, dir: string) {
  const toast = useToast();
  const qc = useQueryClient();
  const factors = useQuery({ queryKey: ['admin-grading-factors', dir], queryFn: () => gradingApi.factors(dir || undefined) });

  const save = useMutation({
    mutationFn: (p: SaveFactorPayload) => gradingApi.saveFactor(p),
    onSuccess: () => { toast.show('Формулировка сохранена', 'ok'); void qc.invalidateQueries({ queryKey: ['admin-grading-factors', dir] }); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось сохранить', 'error')
  });

  const reset = useMutation({
    mutationFn: (idx: number) => gradingApi.resetFactor({ scope, idx, dir }),
    onSuccess: () => { toast.show('Формулировка возвращена к исходной', 'ok'); void qc.invalidateQueries({ queryKey: ['admin-grading-factors', dir] }); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось сбросить', 'error')
  });

  const rows = scope === 'risk' ? factors.data?.riskFactors : factors.data?.criteria;

  return {
    rows, loading: factors.isLoading, error: factors.error as Error | null,
    save: save.mutate, reset: reset.mutate
  };
}

export function useBlockPositions(block: string) {
  const toast = useToast();
  const qc = useQueryClient();
  const positions = useQuery({ queryKey: ['admin-block-positions', block], queryFn: () => gradingApi.adminBlockPositions(block), enabled: !!block });

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ['admin-block-positions'] });
    void qc.invalidateQueries({ queryKey: ['admin-grading-blocks'] });
  };

  const reassign = useMutation({
    mutationFn: (a: { unit: string; position: string; block: string }) => gradingApi.reassignBlockPosition(a),
    onSuccess: () => { toast.show('Перенесено', 'ok'); invalidateAll(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось перенести', 'error')
  });

  const resetEvaluation = useMutation({
    mutationFn: (a: { block: string; job_title: string }) => gradingApi.resetEvaluation(a),
    onSuccess: r => { toast.show(r.message, 'ok'); invalidateAll(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось сбросить оценку', 'error')
  });

  const restoreEvaluation = useMutation({
    mutationFn: (a: { block: string; job_title: string }) => gradingApi.restoreEvaluation(a),
    onSuccess: r => { toast.show(r.message, 'ok'); invalidateAll(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось восстановить оценку', 'error')
  });

  return {
    rows: positions.data?.rows, loading: positions.isLoading, error: positions.error as Error | null,
    reassign: reassign.mutate,
    resetEvaluation: resetEvaluation.mutate,
    restoreEvaluation: restoreEvaluation.mutate
  };
}

export function useCommittee(block: string) {
  const toast = useToast();
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ['admin-committee', block], queryFn: () => gradingApi.committee(block), enabled: !!block });
  const pending = useQuery({ queryKey: ['admin-committee-pending', block], queryFn: () => gradingApi.pendingCommittee(block), enabled: !!block });
  // Тот же ключ кэша, что и в useUsers — второй раз список пользователей не грузится.
  const allUsers = useQuery({ queryKey: ['admin-users'], queryFn: () => adminApi.users() });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin-committee', block] });
    void qc.invalidateQueries({ queryKey: ['admin-committee-pending', block] });
  };

  const add = useMutation({
    mutationFn: (login: string) => gradingApi.addCommitteeMember({ block, login }),
    onSuccess: () => { toast.show('Добавлено', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось добавить', 'error')
  });

  const remove = useMutation({
    mutationFn: (login: string) => gradingApi.removeCommitteeMember({ block, login }),
    onSuccess: () => { toast.show('Исключён', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось исключить', 'error')
  });

  const finalize = useMutation({
    mutationFn: (jobTitle: string) => gradingApi.finalizeCommittee({ block, job_title: jobTitle }),
    onSuccess: r => { toast.show(r.message, 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось подвести итог', 'error')
  });

  const memberLogins = new Set((members.data?.rows ?? []).map(m => m.login));
  const userOptions = (allUsers.data?.users ?? [])
    .filter(u => u.active && !memberLogins.has(u.login))
    .map(u => ({ value: u.login, label: `${u.fio} (${u.login})` }));

  return {
    members: members.data?.rows, membersLoading: members.isLoading,
    pending: pending.data?.rows, committeeSize: pending.data?.committeeSize ?? 0,
    userOptions,
    add: add.mutate, remove: remove.mutate, finalize: finalize.mutate
  };
}
