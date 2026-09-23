import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeriodsScreen } from './PeriodsScreen';
import * as periodsApiModule from '../../../api/periods';

vi.mock('../../shell/Shell', () => ({ useScreenTitle: () => {} }));

const activePeriod = { id: 2, name: 'Обзор рынка 2026', state: 'открыт', isActive: 1, fromDate: null, toDate: null, updatedAt: null, updatedBy: null, surveysCount: 12 };
const archivedEmpty = { id: 1, name: 'Обзор рынка 2025', state: 'закрыт', isActive: 0, fromDate: null, toDate: null, updatedAt: null, updatedBy: null, surveysCount: 0 };
const archivedFull = { id: 0, name: 'Обзор рынка 2024', state: 'закрыт', isActive: 0, fromDate: null, toDate: null, updatedAt: null, updatedBy: null, surveysCount: 5 };

let periodsApiMock: Record<string, ReturnType<typeof vi.fn>>;

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><PeriodsScreen /></QueryClientProvider>);
}

beforeEach(() => {
  periodsApiMock = {
    list: vi.fn().mockResolvedValue({ ok: true, grants: [], periods: [activePeriod, archivedEmpty, archivedFull] }),
    grantUsers: vi.fn().mockResolvedValue({ ok: true, users: [{ login: 'ivanov', fio: 'Иванов Иван', active: true }] }),
    setPeriod: vi.fn().mockResolvedValue({ ok: true, period: {} }),
    deletePeriod: vi.fn().mockResolvedValue({ ok: true }),
    grant: vi.fn().mockResolvedValue({ ok: true }),
    revokeGrant: vi.fn().mockResolvedValue({ ok: true })
  };
  vi.spyOn(periodsApiModule, 'periodsApi', 'get').mockReturnValue(periodsApiMock as never);
});

test('новый период показывает предупреждение о сбросе данных', async () => {
  renderScreen();
  await userEvent.click(await screen.findByRole('button', { name: 'Открыть новый период' }));
  expect(screen.getByText(/Начнётся новый год сбора с чистого листа/)).toBeInTheDocument();
});

test('удаление пустого архивного периода требует подтверждения и вызывает API', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  renderScreen();
  await screen.findAllByText('Обзор рынка 2025');
  const rows = screen.getAllByRole('row');
  const emptyRow = rows.find(r => r.textContent?.includes('Обзор рынка 2025'))!;
  const { getByRole } = within(emptyRow);
  await userEvent.click(getByRole('button', { name: 'Удалить' }));
  await waitFor(() => expect(periodsApiMock.deletePeriod).toHaveBeenCalledWith(1));
});

test('удаление непустого архивного периода недоступно', async () => {
  renderScreen();
  await screen.findAllByText('Обзор рынка 2024');
  const rows = screen.getAllByRole('row');
  const fullRow = rows.find(r => r.textContent?.includes('Обзор рынка 2024'))!;
  const { getByRole } = within(fullRow);
  expect(getByRole('button', { name: 'Удалить' })).toBeDisabled();
});
