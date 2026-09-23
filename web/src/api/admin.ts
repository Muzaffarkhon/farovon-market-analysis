import { request } from './client';
import type {
  AdminUsersResponse, ArchivedUsersResponse, SaveUserPayload, SaveUserResponse, ResetPasswordResponse,
  DivisionsResponse, OkResponse
} from './contract';

export const adminApi = {
  users: () => request<AdminUsersResponse>('/admin/users'),
  saveUser: (payload: SaveUserPayload) => request<SaveUserResponse>('/admin/users', payload),
  toggleUser: (login: string, active: boolean) => request<OkResponse>(`/admin/users/${encodeURIComponent(login)}/toggle`, { active }),
  resetPassword: (login: string) => request<ResetPasswordResponse>(`/admin/users/${encodeURIComponent(login)}/reset-password`, {}),
  usersArchive: () => request<ArchivedUsersResponse>('/admin/users-archive'),
  archiveUser: (login: string) => request<OkResponse>(`/admin/users/${encodeURIComponent(login)}/archive`, {}),
  restoreUser: (login: string) => request<OkResponse>(`/admin/users/${encodeURIComponent(login)}/restore`, {}),

  divisions: () => request<DivisionsResponse>('/admin/divisions')
};
