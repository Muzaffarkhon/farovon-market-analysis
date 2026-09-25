import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { compReviewApi } from '../../api/compReview';
import { adminApi } from '../../api/admin';
import { ApiError } from '../../api/client';
import { useToast } from '../../design/Toast';
import type {
  AddEmployeePayload, AddVariablePayPayload, CreateDraftPayload, UpdateHeaderPayload, UpdateEmployeePayload
} from '../../api/contract';

/** Названия подразделений для выпадающего списка в шапке заявки (список читает то же право divisions:view, что и справочник в админке). */
export function useUnitOptions() {
  const q = useQuery({ queryKey: ['admin-divisions'], queryFn: () => adminApi.divisions() });
  const options = useMemo(
    () => (q.data?.divisions ?? []).map(d => ({ value: d.unit, label: d.unit })).sort((a, b) => a.label.localeCompare(b.label, 'ru')),
    [q.data]
  );
  return { options, loading: q.isLoading };
}

export function usePositionOptions() {
  const q = useQuery({ queryKey: ['comp-positions'], queryFn: compReviewApi.positions });
  const options = useMemo(() => (q.data?.rows ?? []).map(name => ({ value: name, label: name })), [q.data]);
  return { options, loading: q.isLoading };
}

export function useHrBpOptions() {
  const q = useQuery({ queryKey: ['comp-hr-bp'], queryFn: compReviewApi.hrBp });
  const options = useMemo(() => (q.data?.rows ?? []).map(r => ({ value: r.login, label: r.fio })), [q.data]);
  return { options, loading: q.isLoading };
}

export function useCompAccess() {
  const q = useQuery({ queryKey: ['comp-my-access'], queryFn: compReviewApi.myAccess });
  return {
    canSubmit: q.data?.canSubmit ?? false, canReviewCb: q.data?.canReviewCb ?? false,
    canApproveHrd: q.data?.canApproveHrd ?? false, canPayroll: q.data?.canPayroll ?? false,
    isAdmin: q.data?.isAdmin ?? false, isCommitteeMember: q.data?.isCommitteeMember ?? false, loading: q.isLoading
  };
}

export function useCompReasons() {
  const q = useQuery({ queryKey: ['comp-reasons'], queryFn: compReviewApi.reasons });
  return { requestTypes: q.data?.requestTypes ?? [], reasons: q.data?.reasons ?? [] };
}

export function useVariablePayKinds() {
  const q = useQuery({ queryKey: ['comp-variable-pay-kinds'], queryFn: compReviewApi.variablePayKinds });
  return q.data?.kinds ?? [];
}

/**
 * Список сотрудников для формы добавления в заявку. Если известно
 * подразделение из шапки заявки (unit) — сеть запрашивается ровно по нему
 * один раз, а видимое поле поиска не подставляет то же название (не дублирует
 * его), а лишь дополнительно фильтрует уже полученный список по ФИО на
 * клиенте. Без подразделения — обычный сетевой поиск по тому, что напечатали
 * (как раньше).
 */
export function useEmployeeSearch(unit?: string) {
  const [query, setQuery] = useState('');
  const networkQuery = unit || query;
  const q = useQuery({ queryKey: ['comp-employees', networkQuery], queryFn: () => compReviewApi.employees(networkQuery) });
  const rows = useMemo(() => {
    const all = q.data?.rows ?? [];
    if (!unit) return all;
    const nq = query.trim().toLowerCase();
    return nq ? all.filter(r => r.fio.toLowerCase().includes(nq)) : all;
  }, [q.data, unit, query]);
  return { query, setQuery, rows, loading: q.isLoading };
}

/**
 * Файлы сотрудника, прикреплённые через Telegram-бота (см. createAttachToken
 * в compReviewService — веб-загрузки нет, только через бота). `polling`
 * включает частый рефетч на несколько минут после запроса ссылки — файл
 * приходит асинхронно, отдельным сообщением боту, и должен сам появиться
 * в карточке без ручного обновления страницы.
 */
export function useAttachments(employeeId: number) {
  const qc = useQueryClient();
  const onError = useToastError();
  const [polling, setPolling] = useState(false);
  const q = useQuery({
    queryKey: ['comp-attachments', employeeId],
    queryFn: () => compReviewApi.attachments(employeeId),
    refetchInterval: polling ? 4000 : false
  });

  const requestTokenMutation = useMutation({
    mutationFn: () => compReviewApi.createAttachToken(employeeId),
    onSuccess: (r) => {
      setPolling(true);
      setTimeout(() => setPolling(false), r.expiresInMinutes * 60 * 1000);
    },
    onError: e => onError(e, 'Не удалось создать ссылку на бота')
  });

  const removeMutation = useMutation({
    mutationFn: (attachmentId: number) => compReviewApi.deleteAttachment(attachmentId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['comp-attachments', employeeId] }),
    onError: e => onError(e, 'Не удалось удалить файл')
  });

  return {
    rows: q.data?.rows ?? [], loading: q.isLoading, polling,
    requestToken: requestTokenMutation.mutateAsync, requestingToken: requestTokenMutation.isPending,
    remove: removeMutation.mutate
  };
}

function useToastError() {
  const toast = useToast();
  return (e: unknown, fallback: string) => toast.show(e instanceof ApiError ? e.message : fallback, 'error');
}

export function useRequestsList(tab: string) {
  const q = useQuery({ queryKey: ['comp-requests', tab], queryFn: () => compReviewApi.list(tab) });
  return { rows: q.data?.rows ?? [], loading: q.isLoading };
}

/** Всё действие над одной заявкой — черновик, согласование, голосование, кадровик. */
export function useCompRequest(id: number | null) {
  const toast = useToast();
  const onError = useToastError();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['comp-request', id], queryFn: () => compReviewApi.get(id as number), enabled: id != null });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['comp-request', id] });
    void qc.invalidateQueries({ queryKey: ['comp-requests'] });
  };

  function useMut<A>(fn: (a: A) => Promise<unknown>, okMsg?: string, errMsg = 'Не удалось выполнить действие') {
    return useMutation({
      mutationFn: fn,
      onSuccess: () => { if (okMsg) toast.show(okMsg, 'ok'); invalidate(); },
      onError: e => onError(e, errMsg)
    });
  }

  const addEmployee = useMut((e: AddEmployeePayload) => compReviewApi.addEmployee(id as number, e), undefined, 'Не удалось добавить сотрудника');
  const updateEmployee = useMut((a: { employeeId: number; patch: UpdateEmployeePayload }) => compReviewApi.updateEmployee(id as number, a.employeeId, a.patch));
  const removeEmployee = useMut((employeeId: number) => compReviewApi.removeEmployee(id as number, employeeId));
  const addVariablePay = useMut((a: { employeeId: number; data: AddVariablePayPayload }) => compReviewApi.addVariablePay(id as number, a.employeeId, a.data));
  const removeVariablePay = useMut((variablePayId: number) => compReviewApi.removeVariablePay(id as number, variablePayId));
  const updateHeader = useMut((header: UpdateHeaderPayload) => compReviewApi.updateHeader(id as number, header));
  const submit = useMut(() => compReviewApi.submitDraft(id as number), 'Заявка отправлена на проверку C&B');

  const cbReturn = useMut((comment: string) => compReviewApi.cbReturn(id as number, comment), 'Возвращена на доработку');
  const cbForward = useMut(() => compReviewApi.cbForward(id as number), 'Передана на согласование HRD');
  const setMarketData = useMut((a: { employeeId: number; marketMin?: number; marketMedian?: number; marketMax?: number }) =>
    compReviewApi.setMarketData(id as number, a.employeeId, { marketMin: a.marketMin, marketMedian: a.marketMedian, marketMax: a.marketMax }));

  const hrdApprove = useMut(() => compReviewApi.hrdApprove(id as number), 'Согласовано');
  const hrdReject = useMut((comment: string) => compReviewApi.hrdReject(id as number, comment), 'Отклонено');

  const vote = useMut((a: { employeeId: number; vote: 'for' | 'against'; comment?: string }) => compReviewApi.vote(a.employeeId, a.vote, a.comment), 'Голос учтён');
  const forceDecide = useMut((a: { employeeId: number; decision: 'approved' | 'rejected' }) => compReviewApi.forceDecide(a.employeeId, a.decision), 'Решение принято');
  const remindVoters = useMut((employeeId: number) => compReviewApi.remindVoters(employeeId), 'Напоминание отправлено');
  const markPayrollEntered = useMut((a: { employeeId: number; comment?: string; effectiveDate?: string }) =>
    compReviewApi.markPayrollEntered(a.employeeId, { comment: a.comment, effectiveDate: a.effectiveDate }), 'Отмечено как внесено в 1С');

  const addComment = useMut((comment: string) => compReviewApi.addComment(id as number, comment));
  const deleteDraftMutation = useMutation({
    mutationFn: () => compReviewApi.deleteDraft(id as number),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['comp-requests'] }),
    onError: (e: unknown) => onError(e, 'Не удалось удалить черновик')
  });

  return {
    request: q.data?.request, loading: q.isLoading, error: q.error,
    addEmployee: addEmployee.mutate, updateEmployee: updateEmployee.mutate, removeEmployee: removeEmployee.mutate,
    addVariablePay: addVariablePay.mutate, removeVariablePay: removeVariablePay.mutate,
    updateHeader: updateHeader.mutate, submit: submit.mutate, submitting: submit.isPending,
    cbReturn: cbReturn.mutate, cbForward: cbForward.mutate, setMarketData: setMarketData.mutate,
    hrdApprove: hrdApprove.mutate, hrdReject: hrdReject.mutate,
    vote: vote.mutate, voting: vote.isPending, forceDecide: forceDecide.mutate,
    remindVoters: remindVoters.mutate, markPayrollEntered: markPayrollEntered.mutate,
    addComment: addComment.mutate, deleteDraft: deleteDraftMutation.mutateAsync
  };
}

export function useCreateDraft() {
  const onError = useToastError();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (payload: CreateDraftPayload) => compReviewApi.createDraft(payload),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['comp-requests'] }),
    onError: e => onError(e, 'Не удалось создать черновик')
  });
  return { create: m.mutateAsync, creating: m.isPending };
}
