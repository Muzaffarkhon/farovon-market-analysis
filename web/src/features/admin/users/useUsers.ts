import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../../api/admin';
import { accessApi } from '../../../api/access';
import { ApiError } from '../../../api/client';
import type { SaveUserPayload } from '../../../api/contract';
import { useToast } from '../../../design/Toast';

export function useUsers() {
  const toast = useToast();
  const qc = useQueryClient();

  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => adminApi.users() });
  const archived = useQuery({ queryKey: ['admin-users-archive'], queryFn: () => adminApi.usersArchive() });
  const roles = useQuery({ queryKey: ['role-matrix-for-users'], queryFn: () => accessApi.roleMatrix() });
  const divisions = useQuery({ queryKey: ['admin-divisions-for-users'], queryFn: () => adminApi.divisions() });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin-users'] });
    void qc.invalidateQueries({ queryKey: ['admin-users-archive'] });
  };

  const save = useMutation({
    mutationFn: (payload: SaveUserPayload) => adminApi.saveUser(payload),
    onSuccess: r => { toast.show(r.message, 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось сохранить пользователя', 'error')
  });

  const toggle = useMutation({
    mutationFn: (a: { login: string; active: boolean }) => adminApi.toggleUser(a.login, a.active),
    onSuccess: () => invalidate(),
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось изменить статус', 'error')
  });

  const resetPassword = useMutation({
    mutationFn: (login: string) => adminApi.resetPassword(login),
    onSuccess: () => toast.show('Новый пароль отправлен пользователю в Telegram', 'ok'),
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось сбросить пароль', 'error')
  });

  const archive = useMutation({
    mutationFn: (login: string) => adminApi.archiveUser(login),
    onSuccess: () => { toast.show('Пользователь перемещён в архив', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось архивировать', 'error')
  });

  const restore = useMutation({
    mutationFn: (login: string) => adminApi.restoreUser(login),
    onSuccess: () => { toast.show('Пользователь восстановлен', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось восстановить', 'error')
  });

  return {
    users: users.data?.users, usersLoading: users.isLoading, usersError: users.error as Error | null,
    archived: archived.data?.users,
    roles: roles.data?.roles,
    unitOptions: (divisions.data?.divisions ?? []).map(d => d.unit),
    save: save.mutate, saving: save.isPending,
    toggle: toggle.mutate,
    resetPassword: resetPassword.mutate, resettingPassword: resetPassword.isPending,
    archiveUser: archive.mutate,
    restoreUser: restore.mutate
  };
}
