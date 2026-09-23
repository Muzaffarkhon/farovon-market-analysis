import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SupportInboxScreen } from './SupportInboxScreen';
import * as supportApiModule from '../../../api/support';
import * as adminApiModule from '../../../api/admin';
import type { SessionData } from '../../../api/contract';

vi.mock('../../shell/Shell', () => ({ useScreenTitle: () => {} }));

let session: SessionData;
vi.mock('../../auth/useSession', () => ({ useSessionData: () => session }));

function setRole(role: SessionData['user']['role']) {
  session = { user: { role, capabilities: ['support:manage'] } } as unknown as SessionData;
}

let supportApiMock: Record<string, ReturnType<typeof vi.fn>>;

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><SupportInboxScreen /></QueryClientProvider>);
}

const webThread = {
  id: 1, telegram_chat_id: 'web-1-1', phone: null, status: 'open' as const, source: 'web' as const,
  topic: 'Вопрос по зарплате', archived_at: null, last_message_at: '2026-09-24 10:00:00', created_at: '',
  linked_fio: 'Иванов Иван', last_body: 'Когда придёт ответ?', last_direction: 'in' as const, unread_count: 1
};

const guestThread = {
  id: 2, telegram_chat_id: '555', phone: '992900000000', status: 'open' as const, source: 'telegram' as const,
  topic: null, archived_at: null, last_message_at: '2026-09-24 10:00:00', created_at: '',
  linked_fio: null, last_body: 'Кто я?', last_direction: 'in' as const, unread_count: 0
};

function mockApi(overrides: Partial<typeof supportApiMock> = {}) {
  supportApiMock = {
    adminThreads: vi.fn().mockResolvedValue({ ok: true, rows: [webThread] }),
    adminThread: vi.fn().mockResolvedValue({
      ok: true,
      thread: { ...webThread, user_id: 5 },
      messages: [{ id: 1, thread_id: 1, direction: 'in', body: 'Когда придёт ответ?', author_login: null, read_at: null, read_at_user: null, created_at: '2026-09-24 10:00:00' }]
    }),
    adminReply: vi.fn().mockResolvedValue({ ok: true }),
    close: vi.fn().mockResolvedValue({ ok: true }),
    archive: vi.fn().mockResolvedValue({ ok: true }),
    unarchive: vi.fn().mockResolvedValue({ ok: true }),
    remove: vi.fn().mockResolvedValue({ ok: true }),
    linkEmployee: vi.fn().mockResolvedValue({ ok: true, message: 'Привязано к Петрову' }),
    ...overrides
  };
  vi.spyOn(supportApiModule, 'supportApi', 'get').mockReturnValue(supportApiMock as never);
  vi.spyOn(adminApiModule, 'adminApi', 'get').mockReturnValue({
    users: vi.fn().mockResolvedValue({ ok: true, users: [{ id: 9, login: 'petrov', fio: 'Петров Пётр', role: 'user', phone: '992911111111', position: '', units: [], active: true, lastIn: '', hasTelegram: false, hasPassword: true }] })
  } as never);
}

beforeEach(() => setRole('admin'));

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
  fireEvent.change(screen.getByLabelText('Ответ'), { target: { value: 'Ответим завтра' } });
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));
  await waitFor(() => expect(supportApiMock.adminReply).toHaveBeenCalledWith(1, 'Ответим завтра'));
});

test('admin видит архив/удаление, cb с support:manage — нет', async () => {
  mockApi();
  renderScreen();
  await userEvent.click(await screen.findByText('Иванов Иван'));
  await screen.findByRole('dialog');
  expect(screen.getByRole('button', { name: 'В архив' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
});

test('cb с support:manage не видит архив/удаление', async () => {
  setRole('cb');
  mockApi();
  renderScreen();
  await userEvent.click(await screen.findByText('Иванов Иван'));
  await screen.findByRole('dialog');
  expect(screen.queryByRole('button', { name: 'В архив' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument();
});

test('кнопка «Привязать к сотруднику» скрыта для web-треда, видна для гостя бота', async () => {
  mockApi();
  renderScreen();
  await userEvent.click(await screen.findByText('Иванов Иван'));
  await screen.findByRole('dialog');
  expect(screen.queryByRole('button', { name: 'Привязать к сотруднику' })).not.toBeInTheDocument();
});

test('привязка к сотруднику: поиск, подтверждение, вызов API', async () => {
  mockApi({
    adminThreads: vi.fn().mockResolvedValue({ ok: true, rows: [guestThread] }),
    adminThread: vi.fn().mockResolvedValue({ ok: true, thread: { ...guestThread, user_id: null }, messages: [] })
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  renderScreen();
  await userEvent.click(await screen.findByText('Гость #2'));
  await screen.findByRole('dialog');
  await userEvent.click(screen.getByRole('button', { name: 'Привязать к сотруднику' }));
  await userEvent.type(screen.getByLabelText('Поиск сотрудника по ФИО'), 'Петров');
  await userEvent.click(await screen.findByText('Петров Пётр'));
  await waitFor(() => expect(supportApiMock.linkEmployee).toHaveBeenCalledWith(2, 9));
});
