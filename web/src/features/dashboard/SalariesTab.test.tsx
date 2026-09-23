import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SalariesTab } from './SalariesTab';
import type { DashboardResponse, PositionStat } from '../../api/contract';

const position = (over: Partial<PositionStat> = {}): PositionStat => ({
  pos: 'Токарь', count: 3, withSalaryCount: 3, bonCompanies: 1, bonQuantified: 1,
  totalSampleCount: 1, bonTopPer: '', totalMedian: 0, min: 2000, p25: 3000, median: 4000,
  p75: 5000, max: 6000, avg: 4000, forkSpreadPct: 50, ourFrom: 0, ourTo: 0, ourMid: 0,
  gapPct: null, companies: [], ...over
});

const data = (over: Partial<DashboardResponse> = {}): DashboardResponse => ({
  ok: true,
  summary: {
    totalDivisions: 1, completedDivisions: 1, divCompletionPct: 100,
    totalCompetitorLinks: 1, checkedCompetitorLinks: 1, compCompletionPct: 100,
    totalSurveyRecords: 1, recordsWithSalary: 1, positionsCount: 1,
    companiesInSurvey: 1, unmappedRecords: 0, salaryMedian: 4000, salaryP25: 3000, salaryP75: 5000
  },
  hrbpProgress: [], dirProgress: [], dirHrbp: {}, regions: [],
  regionStats: [], trustStats: [], sourceStats: [], scheduleStats: [], gradeStats: [],
  positions: [position()],
  topBenefits: [], bonuses: { hasBonus: 0, noBonus: 0, unknown: 0, types: {}, periods: {} },
  topCompetitors: [], currencies: {},
  period: { name: '2026', state: 'открыт', from: '', to: '', by: '', at: '' },
  periodsList: [], viewingPeriodId: 1, scoped: false,
  ...over
});

test('список должностей рисует строки вилки', () => {
  render(<SalariesTab data={data()} />);
  expect(screen.getByText('Токарь')).toBeInTheDocument();
});

test('сортировка по медиане переставляет строки', async () => {
  const positions = [position({ pos: 'А', count: 1, median: 9000 }), position({ pos: 'Б', count: 5, median: 1000 })];
  render(<SalariesTab data={data({ positions })} />);
  // по умолчанию — по числу наблюдений: «Б» (5) выше «А» (1)
  let labels = screen.getAllByText(/^[АБ]$/).map(e => e.textContent);
  expect(labels).toEqual(['Б', 'А']);

  await userEvent.click(screen.getByRole('button', { name: 'По медиане' }));
  labels = screen.getAllByText(/^[АБ]$/).map(e => e.textContent);
  expect(labels).toEqual(['А', 'Б']);
});

test('клик по строке открывает шторку с компаниями', async () => {
  const positions = [position({
    companies: [{
      company: 'Алиф', unit: 'Цех 1', dir: '', pFrom: 4000, pTo: 4000, avg: 4000,
      hourly: false, hourFrom: 0, hourTo: 0, cur: 'сомони', payPer: 'в месяц',
      bonHas: 'нет', bonSize: '', bonType: '', bonPer: '', bonuses: [],
      varPay: { has: false, label: 'без премии', monthly: null }, total: 4000,
      benefits: [], note: ''
    }]
  })];
  render(<SalariesTab data={data({ positions })} />);
  await userEvent.click(screen.getByText('Токарь'));
  const dialog = await screen.findByRole('dialog', { name: 'Токарь' });
  expect(within(dialog).getByText('Алиф')).toBeInTheDocument();
  expect(within(dialog).getByText(/совокупно ≈ 4 000/)).toBeInTheDocument();
});

test('пустой список должностей — сообщение вместо пустой таблицы', () => {
  render(<SalariesTab data={data({ positions: [] })} />);
  expect(screen.getByText('По выбранным фильтрам должностей не найдено.')).toBeInTheDocument();
});
