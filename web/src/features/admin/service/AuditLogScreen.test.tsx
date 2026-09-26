import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as adminApiModule from '../../../api/admin';
import { AuditLogScreen } from './AuditLogScreen';

vi.mock('../../shell/Shell', () => ({ useScreenTitle: () => {} }));

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AuditLogScreen /></QueryClientProvider>);
}

function mockApi() {
  return vi.spyOn(adminApiModule.adminApi, 'auditLog').mockResolvedValue({
    ok: true,
    logs: [
      { id: 1, dt: '2026-09-24 10:00:00', login: 'admin', action: 'создание пользователя', detail: 'ivanov', ip: '1.2.3.4' },
      { id: 2, dt: '2026-09-23 09:00:00', login: 'hrbp', action: 'рассылка', detail: 'Рассылка #10: доставлено 5 из 5', ip: '5.6.7.8' }
    ]
  });
}

describe('AuditLogScreen', () => {
  // Узкий экран показывает ту же таблицу компактной версткой (AuditLogScreen.tsx,
  // .tableCompact) — та же запись оказывается в DOM дважды (jsdom не считает
  // media query), поэтому проверки строк и текста здесь и ниже нарочно
  // scoped на первую (полную) таблицу.
  function fullTable() {
    return screen.getAllByRole('table')[0];
  }
  function rows() {
    return within(fullTable()).getAllByRole('row').slice(1); // без заголовка
  }

  it('показывает записи журнала', async () => {
    mockApi();
    renderScreen();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(within(fullTable()).getByText('ivanov')).toBeInTheDocument();
    expect(within(fullTable()).getByText(/Рассылка #10/)).toBeInTheDocument();
  });

  it('поиск фильтрует по логину и деталям', async () => {
    mockApi();
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(rows()).toHaveLength(2));

    await user.type(screen.getByLabelText('Поиск'), 'ivanov');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(fullTable()).getByText('ivanov')).toBeInTheDocument();
  });

  it('фильтр по действию сужает список', async () => {
    mockApi();
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(rows()).toHaveLength(2));

    await user.selectOptions(screen.getByLabelText('Действие'), 'рассылка');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(fullTable()).getByText(/Рассылка #10/)).toBeInTheDocument();
  });
});
