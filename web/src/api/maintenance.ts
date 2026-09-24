import { request } from './client';
import type { CompanyUsageResponse, PositionUsageResponse, SimilarNamesResponse, MergeResponse } from './contract';

// Все задачи обслуживания на сервере идут через один эндпоинт с taskType
// (src/controllers/adminController.js, runMaintenance) — здесь только те
// задачи, что нужны инструменту «Объединение дублей».
export const maintenanceApi = {
  companyUsage: () => request<CompanyUsageResponse>('/admin/maintenance', { taskType: 'company_usage' }),
  positionUsage: () => request<PositionUsageResponse>('/admin/maintenance', { taskType: 'position_usage' }),
  similarNames: (kind: 'companies' | 'positions') => request<SimilarNamesResponse>('/admin/maintenance', { taskType: 'find_similar_names', kind }),
  mergeCompanies: (keep: string, merge: string[]) => request<MergeResponse>('/admin/maintenance', { taskType: 'merge_companies', keep, merge }),
  mergePositions: (keep: string, merge: string[]) => request<MergeResponse>('/admin/maintenance', { taskType: 'merge_positions', keep, merge })
};
