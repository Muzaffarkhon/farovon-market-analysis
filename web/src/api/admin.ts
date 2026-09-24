import { request } from './client';
import type {
  AdminUsersResponse, ArchivedUsersResponse, SaveUserPayload, SaveUserResponse, ResetPasswordResponse,
  DivisionsResponse, OkResponse,
  SaveDivisionPayload, CreateDivisionPayload, CreateDivisionResponse, MoveDivisionPayload, MoveDivisionResponse,
  BatchAssignPayload, BatchAssignResponse,
  ApplyAdjacentGroupPayload, ApplyAdjacentGroupResponse, ClearAdjacentGroupPayload, ClearAdjacentGroupResponse,
  StaffDirectoryResponse, SaveStaffPayload, SaveStaffResponse, StaffImportDryRunResponse, StaffImportCommitResponse,
  AuditLogResponse
} from './contract';

export const adminApi = {
  users: () => request<AdminUsersResponse>('/admin/users'),
  saveUser: (payload: SaveUserPayload) => request<SaveUserResponse>('/admin/users', payload),
  toggleUser: (login: string, active: boolean) => request<OkResponse>(`/admin/users/${encodeURIComponent(login)}/toggle`, { active }),
  resetPassword: (login: string) => request<ResetPasswordResponse>(`/admin/users/${encodeURIComponent(login)}/reset-password`, {}),
  usersArchive: () => request<ArchivedUsersResponse>('/admin/users-archive'),
  archiveUser: (login: string) => request<OkResponse>(`/admin/users/${encodeURIComponent(login)}/archive`, {}),
  restoreUser: (login: string) => request<OkResponse>(`/admin/users/${encodeURIComponent(login)}/restore`, {}),

  divisions: () => request<DivisionsResponse>('/admin/divisions'),
  saveDivision: (payload: SaveDivisionPayload) => request<OkResponse>('/admin/divisions', payload),
  createDivision: (payload: CreateDivisionPayload) => request<CreateDivisionResponse>('/admin/divisions/create', payload),
  moveDivision: (payload: MoveDivisionPayload) => request<MoveDivisionResponse>('/admin/divisions/move', payload),
  hideDivision: (unit: string, hidden: boolean) => request<OkResponse>('/admin/divisions/hide', { unit, hidden }),
  deleteDivision: (unit: string) => request<OkResponse>('/admin/divisions/delete', { unit }),
  batchAssign: (payload: BatchAssignPayload) => request<BatchAssignResponse>('/admin/divisions/batch-assign', payload),
  applyAdjacentGroup: (payload: ApplyAdjacentGroupPayload) => request<ApplyAdjacentGroupResponse>('/admin/divisions/adjacent-group', payload),
  clearAdjacentGroup: (payload: ClearAdjacentGroupPayload) => request<ClearAdjacentGroupResponse>('/admin/divisions/adjacent-group/clear', payload),

  staffDirectory: () => request<StaffDirectoryResponse>('/admin/staff-directory'),
  saveStaffRecord: (payload: SaveStaffPayload) => request<SaveStaffResponse>('/admin/staff-directory', payload),
  deleteStaffRecord: (id: number) => request<OkResponse>('/admin/staff-directory/delete', { id }),
  importStaffDirectoryDryRun: (csv: string) => request<StaffImportDryRunResponse>('/admin/import-staff-directory', { csv, dryRun: true }),
  importStaffDirectoryCommit: (csv: string) => request<StaffImportCommitResponse>('/admin/import-staff-directory', { csv, dryRun: false }),

  auditLog: (limit = 200) => request<AuditLogResponse>(`/admin/audit-log?limit=${limit}`)
};
