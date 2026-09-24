import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmHost } from '../../../design/Confirm';
import * as broadcastApiModule from '../../../api/broadcast';
import { BroadcastScreen } from './BroadcastScreen';

vi.mock('../../shell/Shell', () => ({ useScreenTitle: () => {} }));

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ConfirmHost><BroadcastScreen /></ConfirmHost></QueryClientProvider>);
}

function mockApi() {
  vi.spyOn(broadcastApiModule.broadcastApi, 'recipients').mockResolvedValue({
    ok: true,
    totalActive: 2,
    rows: [
      { id: 1, login: 'ivanov', fio: 'Иванов Иван', role: 'user', units: ['Бухгалтерия'] },
      { id: 2, login: 'petrov', fio: 'Петров Пётр', role: 'user', units: ['Продажи'] }
    ]
  });
  vi.spyOn(broadcastApiModule.broadcastApi, 'list').mockResolvedValue({
    ok: true,
    rows: [{ id: 10, author_login: 'admin', body: 'Заполните анкету', with_button: 1, total: 5, sent: 5, failed: 0, created_at: '2026-09-20 10:00:00' }]
  });
  return vi.spyOn(broadcastApiModule.broadcastApi, 'send').mockResolvedValue({ ok: true, id: 11, total: 1, sent: 1, failed: 0 });
}

describe('BroadcastScreen', () => {
  it('показывает получателей и историю рассылок', async () => {
    mockApi();
    renderScreen();
    await waitFor(() => expect(screen.getByText('Иванов Иван')).toBeInTheDocument());
    expect(screen.getByText('Петров Пётр')).toBeInTheDocument();
    expect(screen.getByText(/Заполните анкету/)).toBeInTheDocument();
  });

  it('кнопка «Отправить» выключена, пока не выбраны текст и получатели', async () => {
    mockApi();
    renderScreen();
    await waitFor(() => expect(screen.getByText('Иванов Иван')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();
  });

  it('после подтверждения отправляет выбранным получателям', async () => {
    const send = mockApi();
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(screen.getByText('Иванов Иван')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Текст рассылки'), 'Проверьте данные');
    await user.click(screen.getByRole('checkbox', { name: /Иванов Иван/ }));
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    const dialogButtons = await screen.findAllByRole('button', { name: 'Отправить' });
    await user.click(dialogButtons[dialogButtons.length - 1]);

    await waitFor(() => expect(send.mock.calls[0]?.[0]).toEqual({ body: 'Проверьте данные', withButton: true, userIds: [1] }));
  });
});
