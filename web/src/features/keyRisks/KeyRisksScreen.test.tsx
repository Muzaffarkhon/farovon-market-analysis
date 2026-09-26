import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { KeyRisksScreen } from './KeyRisksScreen';
import * as keyRisksApiModule from '../../api/keyRisks';
import * as gradingApiModule from '../../api/grading';
import type { SessionData } from '../../api/contract';

vi.mock('../shell/Shell', () => ({ useScreenTitle: () => {} }));
vi.mock('../auth/useSession', () => ({
  useSessionData: () => ({
    user: { role: 'admin' },
    units: [{ unit: 'Цех 1', dir: 'Дивизион Север', group: '', total: 0, done: 0, surveys: 0, note: '' }]
  }) as unknown as SessionData
}));

const heatmapRows = [{ dir: 'Дивизион Север', standard: 5, attention: 2, critical: 1, total: 8 }];
const listRow = {
  id: 1, unit: 'Цех 1', employee_fio: 'Критичный', job_title: 'Мастер',
  bus_factor: 5, replacement_time: 5, knowledge_monopoly: 5, financial_risk: 5,
  total_risk_score: 20, risk_status: 'critical' as const, action_plan: '', evaluator_fio: '', updated_at: ''
};

function renderScreen(initial = '/key-risks') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes><Route path="/key-risks/:dir?" element={<KeyRisksScreen />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.spyOn(keyRisksApiModule, 'keyRisksApi', 'get').mockReturnValue({
    heatmap: vi.fn().mockResolvedValue({ ok: true, rows: heatmapRows }),
    list: vi.fn().mockResolvedValue({ ok: true, levels: [], rows: [listRow] }),
    unitEmployees: vi.fn().mockResolvedValue({ ok: true, rows: [] }),
    evaluate: vi.fn(), delete: vi.fn()
  } as never);
  vi.spyOn(gradingApiModule, 'gradingApi', 'get').mockReturnValue({
    factors: vi.fn().mockResolvedValue({ ok: true, criteria: [], weights: [], maxGrade: 1, grades: [], riskFactors: [], riskLevels: [] }),
    blocks: vi.fn(), positions: vi.fn(), evaluate: vi.fn(), stats: vi.fn()
  } as never);
});

test('без направления в адресе показывает карточки направлений', async () => {
  renderScreen();
  expect(await screen.findByText('Дивизион Север')).toBeInTheDocument();
  expect(screen.getByText(/8 оценено/)).toBeInTheDocument();
});

test('клик по направлению открывает список оценённых сотрудников', async () => {
  renderScreen();
  await userEvent.click(await screen.findByRole('link', { name: /Дивизион Север/ }));
  expect(await screen.findByText('Критичный')).toBeInTheDocument();
});

test('направление из адреса открывается сразу', async () => {
  renderScreen('/key-risks/' + encodeURIComponent('Дивизион Север'));
  expect(await screen.findByText('Критичный')).toBeInTheDocument();
});
