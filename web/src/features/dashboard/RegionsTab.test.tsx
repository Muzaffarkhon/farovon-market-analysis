import { render, screen } from '@testing-library/react';
import { RegionsTab } from './RegionsTab';
import type { DashboardResponse, RegionStat } from '../../api/contract';

const region = (over: Partial<RegionStat> = {}): RegionStat => ({
  region: 'Худжанд', count: 10, min: 2000, p25: 3000, median: 4000, p75: 5000, max: 6000, avg: 4000, ...over
});

const data = (regionStats: RegionStat[]): DashboardResponse => ({
  ok: true,
  summary: {
    totalDivisions: 1, completedDivisions: 1, divCompletionPct: 100,
    totalCompetitorLinks: 1, checkedCompetitorLinks: 1, compCompletionPct: 100,
    totalSurveyRecords: 1, recordsWithSalary: 1, positionsCount: 1,
    companiesInSurvey: 1, unmappedRecords: 0, salaryMedian: 4000, salaryP25: 3000, salaryP75: 5000
  },
  hrbpProgress: [], dirProgress: [], dirHrbp: {}, regions: regionStats.map(r => r.region),
  regionStats, trustStats: [], sourceStats: [], scheduleStats: [], gradeStats: [],
  positions: [], topBenefits: [], bonuses: { hasBonus: 0, noBonus: 0, unknown: 0, types: {}, periods: {} },
  topCompetitors: [], currencies: {},
  period: { name: '2026', state: 'открыт', from: '', to: '', by: '', at: '' },
  periodsList: [], viewingPeriodId: 1, scoped: false
});

test('таблица регионов показывает вилку каждого региона', () => {
  render(<RegionsTab data={data([region()])} />);
  expect(screen.getByRole('columnheader', { name: 'Регион' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'Худжанд' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '10' })).toBeInTheDocument();
});

test('без регионов — сообщение вместо пустой таблицы', () => {
  render(<RegionsTab data={data([])} />);
  expect(screen.getByText(/регион не определён/)).toBeInTheDocument();
});
