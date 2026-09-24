import { request } from './client';
import type {
  SalaryReasonsResponse, SalaryEmployeesResponse, SalaryRequestResponse, SalaryRequestsResponse,
  CreateSalaryRequestPayload, DecideSalaryRequestPayload, SalaryHistoryResponse,
  SalaryMyAccessResponse, SalaryCommitteeResponse, OkResponse
} from './contract';

export const salaryApi = {
  myAccess: () => request<SalaryMyAccessResponse>('/salary/my-access'),
  reasons: () => request<SalaryReasonsResponse>('/salary/reasons'),
  employees: (q: string) => request<SalaryEmployeesResponse>('/salary/employees?' + new URLSearchParams({ q })),
  create: (payload: CreateSalaryRequestPayload) => request<SalaryRequestResponse>('/salary/requests', payload),
  queue: (step: string) => request<SalaryRequestsResponse>('/salary/requests/queue?' + new URLSearchParams({ step })),
  list: (status?: string) => request<SalaryRequestsResponse>('/salary/requests' + (status ? '?' + new URLSearchParams({ status }) : '')),
  get: (id: number) => request<SalaryRequestResponse>(`/salary/requests/${id}`),
  decide: (id: number, payload: DecideSalaryRequestPayload) => request<SalaryRequestResponse>(`/salary/requests/${id}/decide`, payload),
  history: (a: { unit?: string; fio?: string } = {}) => {
    const params = new URLSearchParams();
    if (a.unit) params.set('unit', a.unit);
    if (a.fio) params.set('fio', a.fio);
    const qs = params.toString();
    return request<SalaryHistoryResponse>('/salary/history' + (qs ? '?' + qs : ''));
  },

  committee: () => request<SalaryCommitteeResponse>('/salary/committee'),
  addCommitteeMember: (login: string) => request<OkResponse>('/salary/committee/add', { login }),
  removeCommitteeMember: (login: string) => request<OkResponse>('/salary/committee/remove', { login })
};
