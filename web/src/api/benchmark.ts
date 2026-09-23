import { request } from './client';
import type { BenchmarkCompareResult, BenchmarkSummaryWidgets } from './contract';

/**
 * GET с параметрами в строке запроса — единственное место в клиенте, где так
 * нужно: /benchmarks/* остаются серверными GET-маршрутами (раздел ТЗ 12
 * их не трогает), `request()` везде остальном шлёт тело JSON-ом.
 */
export const benchmarkApi = {
  compare: (positionName: string) =>
    request<{ ok: true; result: BenchmarkCompareResult }>('/benchmarks/compare?' + new URLSearchParams({ positionName })),
  summaryWidgets: () =>
    request<{ ok: true; widgets: BenchmarkSummaryWidgets }>('/benchmarks/summary-widgets')
};
