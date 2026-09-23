import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { DashboardScreen } from './DashboardScreen';
import * as api from '../../api/dashboard';
import type { DashboardResponse, SessionData } from '../../api/contract';

vi.mock('../shell/Shell', () => ({ useScreenTitle: () => {} }));

const session = { user: { role: 'cb', capabilities: ['dashboard:view'] } } as unknown as SessionData;
vi.mock('../auth/useSession', () => ({ useSessionData: () => session }));

const answer = (over: Partial<DashboardResponse> = {}): DashboardResponse => ({
  ok: true,
  summary: {
    totalDivisions: 10, completedDivisions: 5, divCompletionPct: 50,
    totalCompetitorLinks: 20, checkedCompetitorLinks: 10, compCompletionPct: 50,
    totalSurveyRecords: 4, recordsWithSalary: 4, positionsCount: 1,
    companiesInSurvey: 3, unmappedRecords: 0,
    salaryMedian: 6000, salaryP25: 4000, salaryP75: 8000
  },
  hrbpProgress: [], dirProgress: [],
  dirHrbp: { 'Дивизион Север': ['Иванов И.'], 'Дивизион Юг': ['Петров П.'] },
  regions: ['Худжанд', 'Душанбе'],
  regionStats: [], trustStats: [], sourceStats: [], scheduleStats: [], gradeStats: [],
  positions: [], topBenefits: [], bonuses: { hasBonus: 0, noBonus: 0, unknown: 0, types: {}, periods: {} },
  topCompetitors: [], currencies: { 'сомони': 4 },
  period: { name: '2026', state: 'открыт', from: '', to: '', by: '', at: '' },
  periodsList: [], viewingPeriodId: 1, scoped: false,
  ...over
});

let lastSearch = '';
function SpyLocation() { lastSearch = useLocation().search; return null; }

function renderScreen(initial = '/dashboard') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes><Route path="/dashboard/:tab?" element={<><DashboardScreen /><SpyLocation /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

let get: ReturnType<typeof vi.fn>;

beforeEach(() => {
  lastSearch = '';
  get = vi.fn().mockResolvedValue(answer());
  vi.spyOn(api, 'dashboardApi', 'get').mockReturnValue({ get } as never);
});

test('без вкладки в адресе показывает «Обзор»', async () => {
  renderScreen('/dashboard');
  expect(await screen.findByRole('heading', { name: 'Обзор' })).toBeInTheDocument();
});

test('вкладка из адреса открывается сразу', async () => {
  renderScreen('/dashboard/salaries');
  expect(await screen.findByRole('heading', { name: 'Зарплатные вилки' })).toBeInTheDocument();
});

test('клик по вкладке переключает панель и адрес', async () => {
  renderScreen('/dashboard');
  await screen.findByRole('heading', { name: 'Обзор' });
  await userEvent.click(screen.getByRole('link', { name: 'По регионам' }));
  expect(await screen.findByRole('heading', { name: 'По регионам' })).toBeInTheDocument();
});

test('выбор направления уходит в запрос и в адрес, сбрасывает HR BP', async () => {
  renderScreen('/dashboard');
  await screen.findByRole('heading', { name: 'Обзор' });
  await userEvent.selectOptions(screen.getByLabelText('Направление'), 'Дивизион Север');
  await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ dir: 'Дивизион Север' })));
  expect(lastSearch).toContain('dir=');
});

test('HR BP предлагает только тех, кто относится к выбранному направлению', async () => {
  renderScreen('/dashboard');
  await screen.findByRole('heading', { name: 'Обзор' });
  await userEvent.selectOptions(screen.getByLabelText('Направление'), 'Дивизион Юг');
  await waitFor(() => expect(screen.getByLabelText('HR BP')).toHaveTextContent('Петров П.'));
  expect(screen.getByLabelText('HR BP')).not.toHaveTextContent('Иванов И.');
});

test('поиск уходит одним запросом с задержкой', async () => {
  renderScreen('/dashboard');
  await screen.findByRole('heading', { name: 'Обзор' });
  await userEvent.type(screen.getByLabelText('Поиск'), 'токарь');
  expect(get).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'токарь' })));
});

test('сброс убирает направление, HR BP и регион из адреса', async () => {
  renderScreen('/dashboard');
  await screen.findByRole('heading', { name: 'Обзор' });
  await userEvent.selectOptions(screen.getByLabelText('Направление'), 'Дивизион Север');
  await userEvent.click(await screen.findByRole('button', { name: 'Сбросить' }));
  await waitFor(() => expect(lastSearch).toBe(''));
});

test('пустой рынок — одно сообщение, вкладки не рендерятся', async () => {
  get.mockResolvedValue(answer({ summary: { ...answer().summary, totalSurveyRecords: 0 } }));
  renderScreen('/dashboard');
  expect(await screen.findByText('За этот период ещё ничего не собрано.')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Обзор' })).not.toBeInTheDocument();
});

test('ограниченной роли сказано, что видны только свои подразделения', async () => {
  get.mockResolvedValue(answer({ scoped: true }));
  renderScreen('/dashboard');
  expect(await screen.findByText('Показаны только ваши подразделения')).toBeInTheDocument();
});
