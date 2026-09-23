import { render, screen } from '@testing-library/react';
import { ProgressTab } from './ProgressTab';
import type { DashboardResponse } from '../../api/contract';

const data = (over: Partial<DashboardResponse> = {}): DashboardResponse => ({
  ok: true,
  summary: {
    totalDivisions: 1, completedDivisions: 1, divCompletionPct: 100,
    totalCompetitorLinks: 1, checkedCompetitorLinks: 1, compCompletionPct: 100,
    totalSurveyRecords: 1, recordsWithSalary: 1, positionsCount: 1,
    companiesInSurvey: 1, unmappedRecords: 0, salaryMedian: 4000, salaryP25: 3000, salaryP75: 5000
  },
  hrbpProgress: [{ hrbp: 'Иванов И.', unitsTotal: 5, unitsDone: 3, compTotal: 10, compDone: 6, surveysTotal: 6, pct: 60 }],
  dirProgress: [{ dir: 'Дивизион Север', unitsTotal: 5, unitsDone: 2, compTotal: 8, compDone: 4, surveysTotal: 4, pct: 50 }],
  dirHrbp: {}, regions: [],
  regionStats: [], trustStats: [], sourceStats: [], scheduleStats: [], gradeStats: [],
  positions: [], topBenefits: [], bonuses: { hasBonus: 0, noBonus: 0, unknown: 0, types: {}, periods: {} },
  topCompetitors: [], currencies: {},
  period: { name: '2026', state: 'открыт', from: '', to: '', by: '', at: '' },
  periodsList: [], viewingPeriodId: 1, scoped: false,
  ...over
});

test('прогресс по HR BP и по направлениям показан рядом', () => {
  render(<ProgressTab data={data()} />);
  expect(screen.getByText('По HR BP')).toBeInTheDocument();
  expect(screen.getByText('Иванов И.')).toBeInTheDocument();
  expect(screen.getByText('По направлениям')).toBeInTheDocument();
  expect(screen.getByText('Дивизион Север')).toBeInTheDocument();
});

test('без подразделений — сообщение вместо пустого списка', () => {
  render(<ProgressTab data={data({ hrbpProgress: [], dirProgress: [] })} />);
  expect(screen.getAllByText('Подразделений не найдено.')).toHaveLength(2);
});
