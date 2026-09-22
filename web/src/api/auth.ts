import { request } from './client';
import type { OkResponse, ResumeResponse } from './contract';

export const authApi = {
  login: (login: string, password: string) => request<ResumeResponse>('/auth/login', { login, password }),
  resume: () => request<ResumeResponse>('/auth/resume'),
  logout: () => request<OkResponse>('/auth/logout', {}),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<OkResponse>('/auth/change-password', { oldPassword, newPassword })
};
