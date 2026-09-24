import { request } from './client';
import type {
  CompanyUsageResponse, PositionUsageResponse, SimilarNamesResponse, MergeResponse,
  DataStatusResponse, LocksResponse, SurveyImportDryRunResponse, SurveyImportCommitResponse
} from './contract';

// Все задачи обслуживания на сервере идут через один эндпоинт с taskType
// (src/controllers/adminController.js, runMaintenance).
export const maintenanceApi = {
  companyUsage: () => request<CompanyUsageResponse>('/admin/maintenance', { taskType: 'company_usage' }),
  positionUsage: () => request<PositionUsageResponse>('/admin/maintenance', { taskType: 'position_usage' }),
  similarNames: (kind: 'companies' | 'positions') => request<SimilarNamesResponse>('/admin/maintenance', { taskType: 'find_similar_names', kind }),
  mergeCompanies: (keep: string, merge: string[]) => request<MergeResponse>('/admin/maintenance', { taskType: 'merge_companies', keep, merge }),
  mergePositions: (keep: string, merge: string[]) => request<MergeResponse>('/admin/maintenance', { taskType: 'merge_positions', keep, merge }),

  dataStatus: () => request<DataStatusResponse>('/admin/data-status'),
  // distribute_companies/undo_distribute отвечают {ok:false, needsConfirm:true, total, message}
  // на первый вызов (без confirm) — ApiError.raw несёт этот объект, второй вызов с confirm:true исполняет.
  runTask: (taskType: string, extra?: Record<string, unknown>) =>
    request<MergeResponse>('/admin/maintenance', { taskType, ...extra }),
  getLocks: () => request<LocksResponse>('/admin/maintenance', { taskType: 'get_locks' }),
  unlock: (a: { targetOwner?: string; targetRole?: string }) =>
    request<MergeResponse>('/admin/maintenance', { taskType: 'unlock', ...a }),

  importSurveyDryRun: (csv: string) => request<SurveyImportDryRunResponse>('/admin/import-survey', { csv, dryRun: true }),
  importSurveyCommit: (csv: string, dupAction: 'skip' | 'update') =>
    request<SurveyImportCommitResponse>('/admin/import-survey', { csv, dryRun: false, dupAction })
};
