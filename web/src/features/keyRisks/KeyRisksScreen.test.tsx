import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { KeyRisksScreen } from './KeyRisksScreen';
import * as keyRisksApiModule from '../../api/keyRisks';
import * as gradingApiModule from '../../api/grading';
import type { SessionData } from '../../api/contract';

vi.mock('../shell/Shell', () => ({ useScreenTitle: () => {} }));
vi.mock('../auth/useSession', () => ({
  useSessionData: () => ({ user: { role: 'admin' }, units: [] }) as unknown as SessionData
}));

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><KeyRisksScreen /></QueryClientProvider>);
}

beforeEach(() => {
  vi.spyOn(keyRisksApiModule, 'keyRisksApi', 'get').mockReturnValue({
    heatmap: vi.fn().mockResolvedValue({ ok: true, rows: [{ dir: 'Дивизион Север', standard: 5, attention: 2, critical: 1, total: 8 }] }),
    list: vi.fn((a: { status?: string }) => Promise.resolve({
      ok: true, levels: [],
      rows: a.status === 'critical' ? [{ id: 1, unit: 'Цех 1', employee_fio: 'Критичный', job_title: 'Мастер', bus_factor: 5, replacement_time: 5, knowledge_monopoly: 5, financial_risk: 5, total_risk_score: 20, risk_status: 'critical', action_plan: '', evaluator_fio: '', updated_at: '' }] : []
    })),
    unitEmployees: vi.fn().mockResolvedValue({ ok: true, rows: [] }),
    evaluate: vi.fn(), delete: vi.fn()
  } as never);
  vi.spyOn(gradingApiModule, 'gradingApi', 'get').mockReturnValue({
    factors: vi.fn().mockResolvedValue({ ok: true, criteria: [], weights: [], maxGrade: 1, grades: [], riskFactors: [], riskLevels: [] }),
    blocks: vi.fn(), positions: vi.fn(), evaluate: vi.fn(), stats: vi.fn()
  } as never);
});

test('тепловая карта и список «Требуют внимания» показаны вместе', async () => {
  renderScreen();
  expect(await screen.findByText('Дивизион Север')).toBeInTheDocument();
  expect(await screen.findByText('Критичный')).toBeInTheDocument();
});

test('KPI-плитка «Оценено сотрудников» суммирует тепловую карту', async () => {
  renderScreen();
  await screen.findByText('Дивизион Север');
  expect(screen.getByText('Оценено сотрудников')).toBeInTheDocument();
  expect(screen.getByText('8')).toBeInTheDocument();
});
