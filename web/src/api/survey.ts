import { request } from './client';
import type {
  AddCompanyResponse, ForPeriodResponse, NoComparisonResponse, SaveDetailsResponse, SelectionsResponse, SurveyDraft
} from './contract';

type PeriodId = number | null;
type PosArgs = { unit: string; posOur: string; periodId: PeriodId; groupKey: string };

export const surveyApi = {
  forPeriod: (unit: string, periodId: PeriodId) =>
    request<ForPeriodResponse>('/survey/for-period', { unit, periodId }),
  selections: (unit: string, periodId: PeriodId) =>
    request<SelectionsResponse>('/survey/position-selections', { unit, periodId }),
  saveSelection: (a: { unit: string; posOur: string; companies: string[]; groupKey: string; periodId: PeriodId }) =>
    request<SaveDetailsResponse>('/survey/position-selection/save', a),
  saveDetails: (a: { unit: string; upsert: SurveyDraft[]; remove?: string[]; groupKey: string; periodId: PeriodId }) =>
    request<SaveDetailsResponse>('/survey/save-details', a),
  addCompany: (name: string, unit: string) =>
    request<AddCompanyResponse>('/survey/dictionary/add', { block: 'companies', name, unit }),
  setNoComparison: (a: PosArgs) => request<NoComparisonResponse>('/survey/no-comparison', a),
  clearNoComparison: (a: PosArgs) => request<NoComparisonResponse>('/survey/no-comparison/clear', a)
};
