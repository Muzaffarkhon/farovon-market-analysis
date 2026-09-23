import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BenchmarkTab } from './BenchmarkTab';
import * as api from '../../api/benchmark';
import type { BenchmarkCompareResult, DashboardResponse, PositionStat } from '../../api/contract';

const position = (over: Partial<PositionStat> = {}): PositionStat => ({
  pos: 'Токарь', count: 1, withSalaryCount: 1, bonCompanies: 0, bonQuantified: 0,
  totalSampleCount: 0, bonTopPer: '', totalMedian: 0, min: 1000, p25: 1000, median: 1000,
  p75: 1000, max: 1000, avg: 1000, forkSpreadPct: 0, ourFrom: 0, ourTo: 0, ourMid: 0,
  gapPct: null, companies: [], ...over
});

const data: DashboardResponse = {
  ok: true,
  summary: {
    totalDivisions: 1, completedDivisions: 1, divCompletionPct: 100,
    totalCompetitorLinks: 1, checkedCompetitorLinks: 1, compCompletionPct: 100,
    totalSurveyRecords: 1, recordsWithSalary: 1, positionsCount: 1,
    companiesInSurvey: 1, unmappedRecords: 0, salaryMedian: 1000, salaryP25: 1000, salaryP75: 1000
  },
  hrbpProgress: [], dirProgress: [], dirHrbp: {}, regions: [],
  regionStats: [], trustStats: [], sourceStats: [], scheduleStats: [], gradeStats: [],
  positions: [position()],
  topBenefits: [], bonuses: { hasBonus: 0, noBonus: 0, unknown: 0, types: {}, periods: {} },
  topCompetitors: [], currencies: {},
  period: { name: '2026', state: 'открыт', from: '', to: '', by: '', at: '' },
  periodsList: [], viewingPeriodId: 1, scoped: false
};

const percentiles = { count: 3, min: 5000, p10: 5200, p25: 5500, p50: 6000, p75: 6500, p90: 6800, max: 7000, avg: 6100 };

const compareResult: BenchmarkCompareResult = {
  position: { id: 1, name: 'Токарь', ourPayFrom: 5000, ourPayTo: 7000, ourMid: 6000 },
  internal: {
    sourceKey: 'internal', sourceTitle: 'Внутренний сбор', observationsCount: 3,
    stats: percentiles, gapPercent: 0, gapAmount: 0, weight: 100, share: 0.5, compaRatio: 1
  },
  external: [{
    sourceKey: 'b1', sourceTitle: 'B1 · Таджикистан', sourceKind: 'external', isLicensed: false,
    dataAsOf: '2026', hasData: true, stats: percentiles,
    gapPercent: -8, gapAmount: -500, weight: 100, share: 0.5, compaRatio: 0.92
  }],
  summary: { sourcesCount: 2, compositeMedian: 6000, compositeGapPercent: -8, compositeGapAmount: -500, compaRatio: 0.92 }
};

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><BenchmarkTab data={data} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.spyOn(api, 'benchmarkApi', 'get').mockReturnValue({
    compare: vi.fn().mockResolvedValue({ ok: true, result: compareResult }),
    summaryWidgets: vi.fn().mockResolvedValue({ ok: true, widgets: { totalPositions: 10, mappedPositions: 4, coveragePercent: 40, belowMarket: [], aboveMarket: [] } })
  } as never);
});

test('без выбранной должности — приглашение выбрать', () => {
  renderTab();
  expect(screen.getByText(/Выберите должность/)).toBeInTheDocument();
});

test('выбор должности показывает вердикт, KPI и таблицу источников', async () => {
  renderTab();
  await userEvent.click(screen.getByLabelText('Должность'));
  await userEvent.click(screen.getByRole('option', { name: 'Токарь' }));
  expect(await screen.findByText('Оклад в рынке')).toBeInTheDocument();
  expect(screen.getByText('Внутренний сбор')).toBeInTheDocument();
  expect(screen.getByText('B1 · Таджикистан')).toBeInTheDocument();
  expect(screen.getByText('-8%')).toBeInTheDocument();
});

test('покрытие сопоставления показано над выбором должности', async () => {
  renderTab();
  expect(await screen.findByText(/4 из 10 должностей/)).toBeInTheDocument();
});
