import { request } from './client';
import type {
  GradingBlock, GradingEvaluateResponse, GradingFactorsResponse, GradingPositionsResponse, GradingStatsResponse,
  SaveFactorPayload, ResetFactorPayload, OkResponse, OkMessageResponse,
  AdminGradingBlocksResponse, AdminBlockPositionsResponse,
  CommitteeResponse, CommitteePendingResponse, CommitteeBreakdownResponse
} from './contract';

export const gradingApi = {
  factors: (dir?: string) => request<GradingFactorsResponse>('/grading/factors' + (dir ? '?' + new URLSearchParams({ dir }) : '')),
  blocks: () => request<{ ok: true; rows: GradingBlock[] }>('/grading/blocks'),
  positions: (block: string) => request<GradingPositionsResponse>('/grading/positions?' + new URLSearchParams({ block })),
  evaluate: (a: { block: string; job_title: string; factors: number[]; notes?: string }) =>
    request<GradingEvaluateResponse>('/grading/evaluate', a),
  stats: () => request<GradingStatsResponse>('/grading/stats'),

  saveFactor: (p: SaveFactorPayload) => request<OkResponse>('/admin/grading-factors', p),
  resetFactor: (p: ResetFactorPayload) => request<OkResponse>('/admin/grading-factors/reset', p),

  adminBlocks: () => request<AdminGradingBlocksResponse>('/admin/grading-blocks'),
  adminBlockPositions: (block: string, q?: string) =>
    request<AdminBlockPositionsResponse>('/admin/grading-blocks/positions?' + new URLSearchParams({ block, ...(q ? { q } : {}) })),
  reassignBlockPosition: (a: { unit: string; position: string; block: string }) =>
    request<OkResponse>('/admin/grading-blocks/reassign', a),
  resetEvaluation: (a: { block: string; job_title: string }) => request<OkMessageResponse>('/admin/grading-blocks/reset-evaluation', a),
  restoreEvaluation: (a: { block: string; job_title: string }) => request<OkMessageResponse>('/admin/grading-blocks/restore-evaluation', a),
  committeeBreakdown: (a: { block: string; job_title: string }) =>
    request<CommitteeBreakdownResponse>('/admin/grading-blocks/committee-breakdown?' + new URLSearchParams(a)),

  committee: (block: string) => request<CommitteeResponse>('/admin/grading-committee?' + new URLSearchParams({ block })),
  addCommitteeMember: (a: { block: string; login: string }) => request<OkResponse>('/admin/grading-committee/add', a),
  removeCommitteeMember: (a: { block: string; login: string }) => request<OkResponse>('/admin/grading-committee/remove', a),
  pendingCommittee: (block: string) => request<CommitteePendingResponse>('/admin/grading-committee/pending?' + new URLSearchParams({ block })),
  finalizeCommittee: (a: { block: string; job_title: string }) => request<OkMessageResponse>('/admin/grading-committee/finalize', a)
};
