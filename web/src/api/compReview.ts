import { request } from './client';
import type {
  CompMyAccessResponse, CompReasonsResponse, CompVariablePayKindsResponse, CompEmployeesResponse, CompPositionsResponse, CompHrBpResponse,
  CompRequestResponse, CompRequestsResponse, CreateDraftPayload, UpdateHeaderPayload, AddEmployeePayload, UpdateEmployeePayload,
  AddVariablePayPayload, CompCommitteeResponse, CompSettingsResponse, CompVoteMode, CompRemindResponse, OkResponse,
  CompAttachmentsResponse, CompAttachTokenResponse
} from './contract';

export const compReviewApi = {
  myAccess: () => request<CompMyAccessResponse>('/comp/my-access'),
  reasons: () => request<CompReasonsResponse>('/comp/reasons'),
  variablePayKinds: () => request<CompVariablePayKindsResponse>('/comp/variable-pay-kinds'),
  employees: (q: string) => request<CompEmployeesResponse>('/comp/employees?' + new URLSearchParams({ q })),
  positions: () => request<CompPositionsResponse>('/comp/positions'),
  hrBp: () => request<CompHrBpResponse>('/comp/hr-bp'),

  createDraft: (payload: CreateDraftPayload) => request<CompRequestResponse>('/comp/requests', payload),
  addEmployee: (requestId: number, employee: AddEmployeePayload) =>
    request<CompRequestResponse>(`/comp/requests/${requestId}`, { action: 'addEmployee', employee }),
  updateEmployee: (requestId: number, employeeId: number, employee: UpdateEmployeePayload) =>
    request<CompRequestResponse>(`/comp/requests/${requestId}`, { action: 'updateEmployee', employeeId, employee }),
  removeEmployee: (requestId: number, employeeId: number) =>
    request<CompRequestResponse>(`/comp/requests/${requestId}`, { action: 'removeEmployee', employeeId }),
  addVariablePay: (requestId: number, employeeId: number, variablePay: AddVariablePayPayload) =>
    request<CompRequestResponse>(`/comp/requests/${requestId}`, { action: 'addVariablePay', employeeId, variablePay }),
  removeVariablePay: (requestId: number, variablePayId: number) =>
    request<CompRequestResponse>(`/comp/requests/${requestId}`, { action: 'removeVariablePay', variablePayId }),
  updateHeader: (requestId: number, header: UpdateHeaderPayload) =>
    request<CompRequestResponse>(`/comp/requests/${requestId}`, { header }),
  submitDraft: (requestId: number) => request<CompRequestResponse>(`/comp/requests/${requestId}/submit`, {}),
  deleteDraft: (requestId: number) => request<OkResponse>(`/comp/requests/${requestId}/delete`, {}),

  list: (tab: string) => request<CompRequestsResponse>('/comp/requests?' + new URLSearchParams({ tab })),
  get: (id: number) => request<CompRequestResponse>(`/comp/requests/${id}`),

  cbReturn: (id: number, comment: string) => request<CompRequestResponse>(`/comp/requests/${id}/cb-return`, { comment }),
  cbForward: (id: number) => request<CompRequestResponse>(`/comp/requests/${id}/cb-forward`, {}),
  setMarketData: (requestId: number, employeeId: number, data: { marketMin?: number; marketMedian?: number; marketMax?: number }) =>
    request<CompRequestResponse>(`/comp/requests/${requestId}/employees/${employeeId}/market-data`, data),

  hrdApprove: (id: number) => request<CompRequestResponse>(`/comp/requests/${id}/hrd-approve`, {}),
  hrdReject: (id: number, comment: string) => request<CompRequestResponse>(`/comp/requests/${id}/hrd-reject`, { comment }),

  vote: (employeeId: number, vote: 'for' | 'against' | 'meeting', comment?: string) =>
    request<CompRequestResponse>(`/comp/employees/${employeeId}/vote`, { vote, comment }),
  forceDecide: (employeeId: number, decision: 'approved' | 'rejected') =>
    request<CompRequestResponse>(`/comp/employees/${employeeId}/force-decide`, { decision }),
  resetVote: (employeeId: number) => request<CompRequestResponse>(`/comp/employees/${employeeId}/reset-vote`, {}),
  remindVoters: (employeeId: number) => request<CompRemindResponse>(`/comp/employees/${employeeId}/remind`, {}),
  markPayrollEntered: (employeeId: number, data: { comment?: string; effectiveDate?: string }) =>
    request<CompRequestResponse>(`/comp/employees/${employeeId}/payroll-entered`, data),

  addComment: (id: number, comment: string) => request<CompRequestResponse>(`/comp/requests/${id}/comments`, { comment }),

  committee: () => request<CompCommitteeResponse>('/comp/committee'),
  addCommitteeMember: (login: string) => request<OkResponse>('/comp/committee/add', { login }),
  removeCommitteeMember: (login: string) => request<OkResponse>('/comp/committee/remove', { login }),

  settings: () => request<CompSettingsResponse>('/comp/settings'),
  saveSettings: (voteMode: CompVoteMode) => request<CompSettingsResponse>('/comp/settings', { voteMode }),

  attachments: (employeeId: number) => request<CompAttachmentsResponse>(`/comp/employees/${employeeId}/attachments`),
  createAttachToken: (employeeId: number) => request<CompAttachTokenResponse>(`/comp/employees/${employeeId}/attachments/token`, {}),
  deleteAttachment: (attachmentId: number) => request<OkResponse>(`/comp/attachments/${attachmentId}/delete`, {}),
  attachmentDownloadUrl: (attachmentId: number) => `/api/comp/attachments/${attachmentId}/download`
};
