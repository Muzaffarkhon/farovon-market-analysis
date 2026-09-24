import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../../api/admin';
import { salaryApi } from '../../../api/salary';
import { ApiError } from '../../../api/client';
import { useToast } from '../../../design/Toast';

export function useSalaryCommittee() {
  const toast = useToast();
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ['salary-committee'], queryFn: salaryApi.committee });
  const allUsers = useQuery({ queryKey: ['admin-users'], queryFn: () => adminApi.users() });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['salary-committee'] });

  const add = useMutation({
    mutationFn: (login: string) => salaryApi.addCommitteeMember(login),
    onSuccess: () => { toast.show('Добавлено', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось добавить', 'error')
  });
  const remove = useMutation({
    mutationFn: (login: string) => salaryApi.removeCommitteeMember(login),
    onSuccess: () => { toast.show('Исключён', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось исключить', 'error')
  });

  const memberLogins = new Set(members.data?.rows ?? []);
  const byLogin = new Map((allUsers.data?.users ?? []).map(u => [u.login, u]));
  const memberRows = [...memberLogins].map(login => ({ login, fio: byLogin.get(login)?.fio ?? login }));
  const userOptions = (allUsers.data?.users ?? [])
    .filter(u => u.active && !memberLogins.has(u.login))
    .map(u => ({ value: u.login, label: `${u.fio} (${u.login})` }));

  return {
    members: memberRows, membersLoading: members.isLoading,
    userOptions,
    add: add.mutate, remove: remove.mutate
  };
}
