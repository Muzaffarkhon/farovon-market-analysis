import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SupportInboxScreen } from './SupportInboxScreen';
import * as supportApiModule from '../../../api/support';

vi.mock('../../shell/Shell', () => ({ useScreenTitle: () => {} }));

let supportApiMock: Record<string, ReturnType<typeof vi.fn>>;

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><SupportInboxScreen /></QueryClientProvider>);
}

const thread = {
  id: 1, telegram_chat_id: 'web-1-1', phone: null, status: 'open' as const, source: 'web' as const,
  topic: 'Вопрос по зарплате', archived_at: null, last_message_at: '2026-09-24 10:00:00', created_at: '',
  linked_fio: 'Иванов Иван', last_body: 'Когда придёт ответ?', last_direction: 'in' as const, unread_count: 1
};

function mockApi(overrides: Partial<typeof supportApiMock> = {}) {
  supportApiMock = {
    adminThreads: vi.fn().mockResolvedValue({ ok: true, rows: [thread] }),
    adminThread: vi.fn().mockResolvedValue({
      ok: true,
      thread: { ...thread, user_id: 5 },
      messages: [{ id: 1, thread_id: 1, direction: 'in', body: 'Когда придёт ответ?', author_login: null, read_at: null, read_at_user: null, created_at: '2026-09-24 10:00:00' }]
    }),
    adminReply: vi.fn().mockResolvedValue({ ok: true }),
    close: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides
  };
  vi.spyOn(supportApiModule, 'supportApi', 'get').mockReturnValue(supportApiMock as never);
}

test('список показывает тред с превью и тегами', async () => {
  mockApi();
  renderScreen();
  expect(await screen.findByText('Иванов Иван')).toBeInTheDocument();
  expect(screen.getByText('Когда придёт ответ?')).toBeInTheDocument();
  expect(screen.getByText('сайт')).toBeInTheDocument();
  expect(screen.getByText('новых: 1')).toBeInTheDocument();
});

test('фильтр «Открыт» уходит в запрос', async () => {
  mockApi();
  renderScreen();
  await screen.findByText('Иванов Иван');
  await userEvent.click(screen.getByRole('button', { name: 'Открыт' }));
  await waitFor(() => expect(supportApiMock.adminThreads).toHaveBeenCalledWith(expect.objectContaining({ status: 'open' })));
});

test('клик по строке открывает детали и позволяет ответить', async () => {
  mockApi();
  renderScreen();
  await userEvent.click(await screen.findByText('Иванов Иван'));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Ответ'), 'Ответим завтра');
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));
  await waitFor(() => expect(supportApiMock.adminReply).toHaveBeenCalledWith(1, 'Ответим завтра'));
});
