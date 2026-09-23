import { render, screen } from '@testing-library/react';
import { BenefitsTab } from './BenefitsTab';
import type { DashboardResponse } from '../../api/contract';

const data = (over: Partial<DashboardResponse> = {}): DashboardResponse => ({
  ok: true,
  summary: {
    totalDivisions: 1, completedDivisions: 1, divCompletionPct: 100,
    totalCompetitorLinks: 1, checkedCompetitorLinks: 1, compCompletionPct: 100,
    totalSurveyRecords: 10, recordsWithSalary: 10, positionsCount: 1,
    companiesInSurvey: 1, unmappedRecords: 0, salaryMedian: 4000, salaryP25: 3000, salaryP75: 5000
  },
  hrbpProgress: [], dirProgress: [], dirHrbp: {}, regions: [],
  regionStats: [], trustStats: [], sourceStats: [], scheduleStats: [], gradeStats: [],
  positions: [],
  topBenefits: [{ name: 'ДМС', count: 4, pct: 40 }],
  bonuses: { hasBonus: 6, noBonus: 3, unknown: 1, types: { 'KPI': 4, 'Годовая': 2 }, periods: { 'в месяц': 4, 'в год': 2 } },
  topCompetitors: [], currencies: {},
  period: { name: '2026', state: 'открыт', from: '', to: '', by: '', at: '' },
  periodsList: [], viewingPeriodId: 1, scoped: false,
  ...over
});

test('рейтинг льгот и переменная часть отрисованы', () => {
  render(<BenefitsTab data={data()} />);
  expect(screen.getByText('ДМС')).toBeInTheDocument();
  expect(screen.getByText('Есть премия')).toBeInTheDocument();
  expect(screen.getByText('KPI')).toBeInTheDocument();
  expect(screen.getByText('в месяц')).toBeInTheDocument();
});

test('доля «есть премия» считается от суммы всех трёх категорий', () => {
  render(<BenefitsTab data={data()} />);
  // 6 из 10 (6+3+1) = 60%
  expect(screen.getByText(/60%/)).toBeInTheDocument();
});

test('без льгот и без премий — сообщения вместо пустых списков', () => {
  render(<BenefitsTab data={data({ topBenefits: [], bonuses: { hasBonus: 0, noBonus: 0, unknown: 0, types: {}, periods: {} } })} />);
  expect(screen.getByText('Льготы ещё не собраны.')).toBeInTheDocument();
  expect(screen.getByText('Виды премии ещё не собраны.')).toBeInTheDocument();
});
