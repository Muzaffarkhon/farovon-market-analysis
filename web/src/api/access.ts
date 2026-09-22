import { request } from './client';
import type { OkResponse, RoleMatrixResponse, UserCapabilitiesResponse } from './contract';

export const accessApi = {
  roleMatrix: () => request<RoleMatrixResponse>('/admin/role-capabilities'),
  saveRole: (role: string, capabilities: string[]) =>
    request<OkResponse>('/admin/role-capabilities', { role, capabilities }),
  userCapabilities: () => request<UserCapabilitiesResponse>('/admin/user-capabilities'),
  setUserCapabilities: (a: { userLogin: string; capabilities: string[]; denied: string[]; expiresAt: string | null }) =>
    request<OkResponse>('/admin/user-capabilities', a)
};
