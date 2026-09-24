import { request } from './client';
import type { ChangeNameResponse, LiveSignatureResponse, OkResponse, ResumeResponse, SetUnitsResponse } from './contract';

export const authApi = {
  login: (login: string, password: string) => request<ResumeResponse>('/auth/login', { login, password }),
  telegramLogin: (initData: string) => request<ResumeResponse>('/auth/telegram', { initData }),
  resume: () => request<ResumeResponse>('/auth/resume'),
  logout: () => request<OkResponse>('/auth/logout', {}),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<OkResponse>('/auth/change-password', { oldPassword, newPassword }),
  changeName: (fio: string) => request<ChangeNameResponse>('/auth/change-name', { fio }),
  setUnits: (units: string[]) => request<SetUnitsResponse>('/auth/set-units', { units }),
  markOnboarded: () => request<OkResponse>('/auth/onboarded', {}),
  liveSignature: () => request<LiveSignatureResponse>('/live-signature')
};
