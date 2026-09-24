import { request } from './client';
import type {
  BenchmarkCompareResult, BenchmarkSummaryWidgets,
  BenchmarkSourcesResponse, CreateSourcePayload, UpdateSourcePayload, SourceResponse, SourceWeightsResponse,
  DatasetsResponse, SourcePositionsResponse, MappingsResponse, SaveMappingPayload, SuggestMappingsResponse, OkMessageResponse,
  FxRateResponse, XlsxSheetsResponse, XlsxGridResponse, BenchmarkImportRequest, DryRunImportResponse, CommitImportResponse
} from './contract';

/**
 * GET с параметрами в строке запроса — единственное место в клиенте, где так
 * нужно: /benchmarks/* остаются серверными GET-маршрутами (раздел ТЗ 12
 * их не трогает), `request()` везде остальном шлёт тело JSON-ом.
 */
export const benchmarkApi = {
  // GET-навигация браузера ради Content-Disposition, без фильтров — сервер
  // всегда отдаёт полную матрицу по всем сопоставленным должностям.
  exportUrl: () => '/api/benchmarks/export',

  compare: (positionName: string) =>
    request<{ ok: true; result: BenchmarkCompareResult }>('/benchmarks/compare?' + new URLSearchParams({ positionName })),
  summaryWidgets: () =>
    request<{ ok: true; widgets: BenchmarkSummaryWidgets }>('/benchmarks/summary-widgets'),

  sources: () => request<BenchmarkSourcesResponse>('/benchmarks/sources'),
  createSource: (p: CreateSourcePayload) => request<SourceResponse>('/benchmarks/sources', p),
  updateSource: (p: UpdateSourcePayload) => request<SourceResponse>('/benchmarks/source-update', p),
  setSourceWeights: (weights: Record<string, number>) => request<SourceWeightsResponse>('/benchmarks/sources/weights', { weights }),

  datasets: (sourceKey?: string) => request<DatasetsResponse>('/benchmarks/datasets' + (sourceKey ? '?' + new URLSearchParams({ sourceKey }) : '')),
  deleteDataset: (id: number) => request<OkMessageResponse>(`/benchmarks/datasets/${id}/delete`, {}),

  sourcePositions: (sourceKey: string) => request<SourcePositionsResponse>(`/benchmarks/positions/${encodeURIComponent(sourceKey)}`),
  mappings: (sourceKey?: string) => request<MappingsResponse>('/benchmarks/mappings' + (sourceKey ? '?' + new URLSearchParams({ sourceKey }) : '')),
  suggestMappings: (sourceKey: string) => request<SuggestMappingsResponse>(`/benchmarks/suggest-mappings/${encodeURIComponent(sourceKey)}`),
  saveMapping: (p: SaveMappingPayload) => request<OkMessageResponse>('/benchmarks/mappings', p),
  deleteMapping: (id: number) => request<OkMessageResponse>(`/benchmarks/mappings/${id}/delete`, {}),

  fx: (currency: string) => request<FxRateResponse>('/benchmarks/fx?' + new URLSearchParams({ currency })),
  xlsxSheets: (fileBase64: string) => request<XlsxSheetsResponse>('/benchmarks/import/xlsx-sheets', { fileBase64 }),
  xlsxGrid: (fileBase64: string, sheet: string) => request<XlsxGridResponse>('/benchmarks/import/xlsx-grid', { fileBase64, sheet }),
  importDryRun: (p: BenchmarkImportRequest) => request<DryRunImportResponse>('/benchmarks/import/dry-run', p),
  importCommit: (p: BenchmarkImportRequest & { fxDate?: string; methodology?: string }) => request<CommitImportResponse>('/benchmarks/import/commit', p)
};
