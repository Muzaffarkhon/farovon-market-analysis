import { request } from './client';
import type {
  GradingBlock, GradingEvaluateResponse, GradingFactorsResponse, GradingPositionsResponse, GradingStatsResponse
} from './contract';

export const gradingApi = {
  factors: (dir?: string) => request<GradingFactorsResponse>('/grading/factors' + (dir ? '?' + new URLSearchParams({ dir }) : '')),
  blocks: () => request<{ ok: true; rows: GradingBlock[] }>('/grading/blocks'),
  positions: (block: string) => request<GradingPositionsResponse>('/grading/positions?' + new URLSearchParams({ block })),
  evaluate: (a: { block: string; job_title: string; factors: number[]; notes?: string }) =>
    request<GradingEvaluateResponse>('/grading/evaluate', a),
  stats: () => request<GradingStatsResponse>('/grading/stats')
};
