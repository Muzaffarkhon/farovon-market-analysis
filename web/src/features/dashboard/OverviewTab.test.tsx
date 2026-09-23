import { render, screen } from '@testing-library/react';
import { OverviewTab } from './OverviewTab';
import type { DashboardResponse, PositionStat } from '../../api/contract';

const position = (over: Partial<PositionStat> = {}): PositionStat => ({
  pos: 'Токарь', count: 5, withSalaryCount: 5, bonCompanies: 2, bonQuantified: 2,
  totalSampleCount: 2, bonTopPer: '', totalMedian: 0, min: 2000, p25: 3000, median: 4000,
  p75: 5000, max: 6000, avg: 4000, forkSpreadPct: 50, ourFrom: 0, ourTo: 0, ourMid: 0,
  gapPct: null, companies: [], ...over
});

const data = (over: Partial<DashboardResponse> = {}): DashboardResponse => ({
  ok: true,
  summary: {
    totalDivisions: 10, completedDivisions: 5, divCompletionPct: 50,
    totalCompetitorLinks: 20, checkedCompetitorLinks: 10, compCompletionPct: 50,
    totalSurveyRecords: 10, recordsWithSalary: 10, positionsCount: 1,
    companiesInSurvey: 3, unmappedRecords: 0,
    salaryMedian: 7400, salaryP25: 5000, salaryP75: 9000
  },
  hrbpProgress: [], dirProgress: [], dirHrbp: {}, regions: [],
  regionStats: [], trustStats: [], sourceStats: [], scheduleStats: [], gradeStats: [],
  positions: [position()],
  topBenefits: [{ name: 'ДМС', count: 4, pct: 40 }],
  bonuses: { hasBonus: 7, noBonus: 2, unknown: 1, types: {}, periods: {} },
  topCompetitors: [], currencies: {},
  period: { name: '2026', state: 'открыт', from: '', to: '', by: '', at: '' },
  periodsList: [], viewingPeriodId: 1, scoped: false,
  ...over
});

test('KPI-плитки показывают медиану, гэп, размах и долю с премией', () => {
  render(<OverviewTab data={data({ positions: [position({ gapPct: -10 }), position({ pos: 'Слесарь', gapPct: 10 })] })} />);
  expect(screen.getByText('7 400')).toBeInTheDocument(); // медиана
  expect(screen.getByText('0')).toBeInTheDocument(); // средний гэп (-10+10)/2
  expect(screen.getByText('54')).toBeInTheDocument(); // (9000-5000)/7400 ≈ 54%
  expect(screen.getByText('70')).toBeInTheDocument(); // 7 из 10 премируют
});

test('без известного гэпа плитка показывает прочерк', () => {
  render(<OverviewTab data={data({ positions: [position({ gapPct: null })] })} />);
  expect(screen.getByText('—')).toBeInTheDocument();
});

test('топ должностей и рейтинг льгот отрисованы', () => {
  render(<OverviewTab data={data()} />);
  expect(screen.getByText('Токарь')).toBeInTheDocument();
  expect(screen.getByText('ДМС')).toBeInTheDocument();
});

test('не больше шести должностей в топе', () => {
  const many = Array.from({ length: 9 }, (_, i) => position({ pos: 'Должность ' + i, count: 9 - i }));
  render(<OverviewTab data={data({ positions: many })} />);
  expect(screen.getAllByText(/^Должность /)).toHaveLength(6);
});
