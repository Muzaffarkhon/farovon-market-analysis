import { request } from './client';
import type { DashboardFilters, DashboardResponse } from './contract';

export const dashboardApi = {
  get: (filters: DashboardFilters) => request<DashboardResponse>('/dashboard', filters)
};
