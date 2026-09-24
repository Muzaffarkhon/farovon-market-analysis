import { request } from './client';
import type { CreateRoleResponse, OkResponse, RenameRoleResponse, RoleMatrixResponse, UserCapabilitiesResponse } from './contract';

export const accessApi = {
  roleMatrix: () => request<RoleMatrixResponse>('/admin/role-capabilities'),
  saveRole: (role: string, capabilities: string[]) =>
    request<OkResponse>('/admin/role-capabilities', { role, capabilities }),
  createRole: (label: string) => request<CreateRoleResponse>('/admin/roles', { label }),
  renameRole: (key: string, label: string) => request<RenameRoleResponse>(`/admin/roles/${encodeURIComponent(key)}/rename`, { label }),
  deleteRole: (key: string) => request<OkResponse>(`/admin/roles/${encodeURIComponent(key)}/delete`, {}),
  userCapabilities: () => request<UserCapabilitiesResponse>('/admin/user-capabilities'),
  setUserCapabilities: (a: { userLogin: string; capabilities: string[]; denied: string[]; expiresAt: string | null }) =>
    request<OkResponse>('/admin/user-capabilities', a)
};
