import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { salaryApi } from '../../api/salary';
import { ApiError } from '../../api/client';
import { useToast } from '../../design/Toast';
import type { CreateSalaryRequestPayload, SalaryStep } from '../../api/contract';

export function useSalaryAccess() {
  const q = useQuery({ queryKey: ['salary-my-access'], queryFn: salaryApi.myAccess });
  return { canRequest: q.data?.canRequest ?? false, steps: q.data?.steps ?? [], loading: q.isLoading };
}

export function useSalaryReasons() {
  const q = useQuery({ queryKey: ['salary-reasons'], queryFn: salaryApi.reasons });
  return q.data?.reasons ?? [];
}

export function useSalaryEmployeeSearch() {
  const [query, setQuery] = useState('');
  const q = useQuery({ queryKey: ['salary-employees', query], queryFn: () => salaryApi.employees(query) });
  return { query, setQuery, rows: q.data?.rows ?? [], loading: q.isLoading };
}

export function useCreateSalaryRequest() {
  const toast = useToast();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (payload: CreateSalaryRequestPayload) => salaryApi.create(payload),
    onSuccess: () => {
      toast.show('Заявка отправлена на согласование', 'ok');
      void qc.invalidateQueries({ queryKey: ['salary-requests'] });
    },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось создать заявку', 'error')
  });
  return { create: m.mutate, creating: m.isPending };
}

export function useSalaryQueue(step: SalaryStep) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['salary-queue', step], queryFn: () => salaryApi.queue(step) });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['salary-queue'] });
    void qc.invalidateQueries({ queryKey: ['salary-history'] });
  };

  const decide = useMutation({
    mutationFn: (a: { id: number; decision: 'approved' | 'rejected'; comment?: string }) =>
      salaryApi.decide(a.id, { step, decision: a.decision, comment: a.comment }),
    onSuccess: (_r, vars) => {
      toast.show(vars.decision === 'approved' ? 'Согласовано' : 'Отклонено', 'ok');
      invalidate();
    },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось сохранить решение', 'error')
  });

  return { rows: q.data?.rows ?? [], loading: q.isLoading, decide: decide.mutate, deciding: decide.isPending };
}

export function useSalaryHistory() {
  const q = useQuery({ queryKey: ['salary-history'], queryFn: () => salaryApi.history() });
  return { rows: q.data?.rows ?? [], loading: q.isLoading };
}
