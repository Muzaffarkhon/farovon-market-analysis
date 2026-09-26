import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BenchmarkAdminScreen } from './BenchmarkAdminScreen';
import * as benchmarkApiModule from '../../../api/benchmark';

vi.mock('../../shell/Shell', () => ({ useScreenTitle: () => {} }));

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><BenchmarkAdminScreen /></QueryClientProvider>);
}

beforeEach(() => {
  vi.spyOn(benchmarkApiModule, 'benchmarkApi', 'get').mockReturnValue({
    sources: vi.fn().mockResolvedValue({ ok: true, sources: [{ key: 'ext1', title: 'Внешний консультант', kind: 'consultancy', is_licensed: 0, default_currency: 'сомони', notes: '', weight: 100, hidden: 0 }] }),
    datasets: vi.fn().mockResolvedValue({ ok: true, datasets: [] }),
    mappings: vi.fn().mockResolvedValue({ ok: true, mappings: [] }),
    suggestMappings: vi.fn().mockResolvedValue({ ok: true, suggestions: [] }),
    createSource: vi.fn(), updateSource: vi.fn(), setSourceWeights: vi.fn(),
    deleteDataset: vi.fn(), saveMapping: vi.fn(), deleteMapping: vi.fn()
  } as never);
});

test('вкладки переключаются: источники, сопоставление, наборы данных', async () => {
  renderScreen();
  expect(await screen.findByRole('button', { name: 'Внешний консультант' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Сопоставление' }));
  expect((await screen.findAllByText('Сопоставлений ещё нет')).length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('button', { name: 'Наборы данных' }));
  expect((await screen.findAllByText('Датасетов пока нет')).length).toBeGreaterThan(0);
});
