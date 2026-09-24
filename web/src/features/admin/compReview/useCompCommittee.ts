import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../../api/admin';
import { compReviewApi } from '../../../api/compReview';
import { ApiError } from '../../../api/client';
import { useToast } from '../../../design/Toast';
import type { CompVoteMode } from '../../../api/contract';

export function useCompCommittee() {
  const toast = useToast();
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ['comp-committee'], queryFn: compReviewApi.committee });
  const allUsers = useQuery({ queryKey: ['admin-users'], queryFn: () => adminApi.users() });
  const settings = useQuery({ queryKey: ['comp-settings'], queryFn: compReviewApi.settings });

  const invalidateMembers = () => void qc.invalidateQueries({ queryKey: ['comp-committee'] });

  const add = useMutation({
    mutationFn: (login: string) => compReviewApi.addCommitteeMember(login),
    onSuccess: () => { toast.show('Добавлено', 'ok'); invalidateMembers(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось добавить', 'error')
  });
  const remove = useMutation({
    mutationFn: (login: string) => compReviewApi.removeCommitteeMember(login),
    onSuccess: () => { toast.show('Исключён', 'ok'); invalidateMembers(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось исключить', 'error')
  });
  const saveVoteMode = useMutation({
    mutationFn: (voteMode: CompVoteMode) => compReviewApi.saveSettings(voteMode),
    onSuccess: () => { toast.show('Сохранено', 'ok'); void qc.invalidateQueries({ queryKey: ['comp-settings'] }); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось сохранить', 'error')
  });

  const memberLogins = new Set(members.data?.rows ?? []);
  const byLogin = new Map((allUsers.data?.users ?? []).map(u => [u.login, u]));
  const memberRows = [...memberLogins].map(login => ({ login, fio: byLogin.get(login)?.fio ?? login }));
  const userOptions = (allUsers.data?.users ?? [])
    .filter(u => u.active && !memberLogins.has(u.login))
    .map(u => ({ value: u.login, label: `${u.fio} (${u.login})` }));

  return {
    members: memberRows, membersLoading: members.isLoading, userOptions,
    add: add.mutate, remove: remove.mutate,
    voteMode: settings.data?.settings.voteMode ?? 'closed', saveVoteMode: saveVoteMode.mutate
  };
}
