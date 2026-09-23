import { request } from './client';
import type { HeatmapResponse, KeyRisksListResponse, OkResponse, RiskEvaluateResponse, UnitEmployeesResponse } from './contract';

export const keyRisksApi = {
  list: (a: { unit?: string; status?: string } = {}) => {
    const params = new URLSearchParams();
    if (a.unit) params.set('unit', a.unit);
    if (a.status) params.set('status', a.status);
    const qs = params.toString();
    return request<KeyRisksListResponse>('/key-personnel/list' + (qs ? '?' + qs : ''));
  },
  unitEmployees: (unit: string) => request<UnitEmployeesResponse>('/key-personnel/unit-employees?' + new URLSearchParams({ unit })),
  evaluate: (a: {
    unit: string; employee_fio: string; job_title: string;
    bus_factor: number; replacement_time: number; knowledge_monopoly: number; financial_risk: number;
    action_plan?: string;
  }) => request<RiskEvaluateResponse>('/key-personnel/evaluate', a),
  heatmap: () => request<HeatmapResponse>('/key-personnel/heatmap'),
  delete: (id: number) => request<OkResponse>('/key-personnel/delete', { id })
};
