import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SupportScreen } from './SupportScreen';
import * as supportApiModule from '../../api/support';

vi.mock('../shell/Shell', () => ({ useScreenTitle: () => {} }));

let supportApiMock: Record<string, ReturnType<typeof vi.fn>>;

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><SupportScreen /></QueryClientProvider>);
}

function mockApi(overrides: Partial<typeof supportApiMock> = {}) {
  supportApiMock = {
    myThreads: vi.fn().mockResolvedValue({ ok: true, rows: [] }),
    myThread: vi.fn().mockResolvedValue({
      ok: true,
      thread: { id: 1, topic: 'Тестовая тема', status: 'open', telegram_chat_id: '', phone: null, source: 'web', archived_at: null, last_message_at: '', created_at: '', linked_fio: null, last_body: null, last_direction: null, unread_count: 0, user_id: 1 },
      messages: []
    }),
    start: vi.fn().mockResolvedValue({ ok: true, id: 1 }),
    reply: vi.fn().mockResolvedValue({ ok: true }),
    faq: vi.fn().mockResolvedValue({ ok: true, rows: [] }),
    ...overrides
  };
  vi.spyOn(supportApiModule, 'supportApi', 'get').mockReturnValue(supportApiMock as never);
}

test('нет обращений — показана форма создания', async () => {
  mockApi();
  renderScreen();
  expect(await screen.findByText('Обращений пока нет.')).toBeInTheDocument();
  expect(screen.getByLabelText('Тема обращения')).toBeInTheDocument();
});

test('есть обращение — показано в списке с превью', async () => {
  mockApi({
    myThreads: vi.fn().mockResolvedValue({
      ok: true,
      rows: [{ id: 1, topic: 'Вопрос по зарплате', status: 'open', last_message_at: '', created_at: '', last_body: 'Когда придёт ответ?', last_direction: 'in', unread_count: 0 }]
    })
  });
  renderScreen();
  expect(await screen.findByText('Вопрос по зарплате')).toBeInTheDocument();
  expect(screen.getByText('Когда придёт ответ?')).toBeInTheDocument();
});

test('отправка формы создаёт обращение', async () => {
  mockApi();
  renderScreen();
  await screen.findByText('Обращений пока нет.');
  await userEvent.type(screen.getByLabelText('Тема обращения'), 'Тестовая тема');
  await userEvent.type(screen.getByLabelText('Опишите вопрос'), 'Текст вопроса');
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));
  await waitFor(() => expect(supportApiMock.start).toHaveBeenCalledWith('Тестовая тема', 'Текст вопроса'));
});

test('FAQ рендерится списком вопросов', async () => {
  mockApi({ faq: vi.fn().mockResolvedValue({ ok: true, rows: [{ id: 1, question: 'Как сменить пароль?', answer: 'В профиле.' }] }) });
  renderScreen();
  expect(await screen.findByText('Как сменить пароль?')).toBeInTheDocument();
});
