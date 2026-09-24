import { request } from './client';
import type { DashboardFilters, DashboardResponse } from './contract';

export const dashboardApi = {
  get: (filters: DashboardFilters) => request<DashboardResponse>('/dashboard', filters),
  // GET, не через request() — нужна настоящая навигация браузера, чтобы
  // сработал Content-Disposition: attachment (fetch+blob здесь ни к чему).
  exportCsvUrl: (filters: DashboardFilters) => {
    const params = new URLSearchParams();
    if (filters.period) params.set('period', String(filters.period));
    if (filters.dir) params.set('dir', filters.dir);
    if (filters.hrbp) params.set('hrbp', filters.hrbp);
    if (filters.region) params.set('region', filters.region);
    if (filters.search) params.set('search', filters.search);
    const qs = params.toString();
    return '/api/dashboard/export-csv' + (qs ? '?' + qs : '');
  }
};
