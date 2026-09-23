import { request } from './client';
import type {
  PeriodGrantsResponse, PeriodGrantUsersResponse, SetPeriodPayload, SetPeriodResponse, OkResponse
} from './contract';

export const periodsApi = {
  list: () => request<PeriodGrantsResponse>('/admin/period-grants'),
  grantUsers: () => request<PeriodGrantUsersResponse>('/admin/period-grants/users'),
  setPeriod: (p: SetPeriodPayload) => request<SetPeriodResponse>('/admin/period', p),
  grant: (userLogin: string, periodId: number) => request<OkResponse>('/admin/period-grants', { userLogin, periodId }),
  revokeGrant: (userLogin: string, periodId: number) => request<OkResponse>('/admin/period-grants/revoke', { userLogin, periodId }),
  deletePeriod: (periodId: number) => request<OkResponse>('/admin/periods/delete', { periodId })
};
