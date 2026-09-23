import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SupportSettingsSheet } from './SupportSettingsSheet';
import * as supportApiModule from '../../../api/support';

let supportApiMock: Record<string, ReturnType<typeof vi.fn>>;

function renderSheet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><SupportSettingsSheet open onClose={() => {}} /></QueryClientProvider>);
}

function mockApi() {
  supportApiMock = {
    quickReplies: vi.fn().mockImplementation((audience: 'admin' | 'guest') => Promise.resolve({
      ok: true,
      rows: audience === 'admin'
        ? [{ id: 1, text: 'Спасибо, разберёмся', audience: 'admin', answer: null }]
        : [{ id: 2, text: 'Как сменить пароль?', audience: 'guest', answer: 'В профиле, кнопка «Сменить пароль».' }]
    })),
    faq: vi.fn().mockResolvedValue({ ok: true, rows: [{ id: 3, question: 'Когда зарплата?', answer: '5 числа.' }] }),
    saveQuickReply: vi.fn().mockResolvedValue({ ok: true, id: 10 }),
    deleteQuickReply: vi.fn().mockResolvedValue({ ok: true }),
    saveFaq: vi.fn().mockResolvedValue({ ok: true, id: 11 }),
    deleteFaq: vi.fn().mockResolvedValue({ ok: true })
  };
  vi.spyOn(supportApiModule, 'supportApi', 'get').mockReturnValue(supportApiMock as never);
}

test('три вкладки переключаются независимо', async () => {
  mockApi();
  renderSheet();
  expect(await screen.findByText('Спасибо, разберёмся')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Вопросы гостям' }));
  expect(await screen.findByText('Как сменить пароль?')).toBeInTheDocument();
  expect(screen.queryByText('Спасибо, разберёмся')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'FAQ' }));
  expect(await screen.findByText('Когда зарплата?')).toBeInTheDocument();
});

test('добавление новой фразы для админов вызывает API', async () => {
  mockApi();
  renderSheet();
  await screen.findByText('Спасибо, разберёмся');
  await userEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
  fireEvent.change(screen.getByLabelText('Текст'), { target: { value: 'Новая фраза' } });
  await userEvent.click(screen.getByRole('button', { name: 'Добавить' }));
  await waitFor(() => expect(supportApiMock.saveQuickReply).toHaveBeenCalled());
  expect(supportApiMock.saveQuickReply.mock.calls[0][0]).toEqual({ id: undefined, text: 'Новая фраза', audience: 'admin' });
});
