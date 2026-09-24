import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsersScreen } from './UsersScreen';
import { ConfirmHost } from '../../../design/Confirm';
import * as adminApiModule from '../../../api/admin';
import * as accessApiModule from '../../../api/access';
import type { SessionData } from '../../../api/contract';

vi.mock('../../shell/Shell', () => ({ useScreenTitle: () => {} }));

// По умолчанию сессия — суперадмин (login «admin»): большинство сценариев
// здесь про саму таблицу и форму, а не про то, кто видит кнопку «Добавить».
let session: SessionData;
vi.mock('../../auth/useSession', () => ({ useSessionData: () => session }));

const activeUser = {
  id: 1, login: 'ivanov', fio: 'Иванов Иван', role: 'user', phone: '', position: 'Мастер',
  units: ['Цех 1'], active: true, lastIn: '', hasTelegram: true, hasPassword: true
};

let adminApiMock: Record<string, ReturnType<typeof vi.fn>>;

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ConfirmHost><UsersScreen /></ConfirmHost></QueryClientProvider>);
}

beforeEach(() => {
  session = { user: { id: 9, login: 'admin', fio: 'Суперадмин', role: 'admin', units: [], capabilities: [], onboarded: true, hasTelegram: true } } as unknown as SessionData;
  adminApiMock = {
    users: vi.fn().mockResolvedValue({ ok: true, users: [activeUser] }),
    usersArchive: vi.fn().mockResolvedValue({ ok: true, users: [] }),
    divisions: vi.fn().mockResolvedValue({ ok: true, divisions: [{ unit: 'Цех 1' }, { unit: 'Цех 2' }], groupSuggestions: [] }),
    saveUser: vi.fn().mockResolvedValue({ ok: true, login: 'petrov', message: 'Пользователь создан' }),
    toggleUser: vi.fn().mockResolvedValue({ ok: true }),
    resetPassword: vi.fn().mockResolvedValue({ ok: true, login: 'ivanov', delivered: true }),
    archiveUser: vi.fn().mockResolvedValue({ ok: true }),
    restoreUser: vi.fn().mockResolvedValue({ ok: true })
  };
  vi.spyOn(adminApiModule, 'adminApi', 'get').mockReturnValue(adminApiMock as never);
  vi.spyOn(accessApiModule, 'accessApi', 'get').mockReturnValue({
    roleMatrix: vi.fn().mockResolvedValue({ ok: true, capabilities: [], matrix: {}, roles: [{ key: 'user', label: 'Сотрудник' }] })
  } as never);
});

test('таблица показывает пользователя из ответа API', async () => {
  renderScreen();
  expect(await screen.findByText('Иванов Иван')).toBeInTheDocument();
  expect(screen.getByText('Мастер')).toBeInTheDocument();
});

test('выключение активности запрашивает подтверждение', async () => {
  renderScreen();
  await screen.findByText('Иванов Иван');
  await userEvent.click(screen.getByRole('checkbox', { name: /активен/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Отмена' }));
  expect(adminApiMock.toggleUser).not.toHaveBeenCalled();
});

test('подтверждённый сброс пароля вызывает API', async () => {
  renderScreen();
  await screen.findByText('Иванов Иван');
  await userEvent.click(screen.getByRole('button', { name: 'Сброс пароля' }));
  await userEvent.click(await screen.findByRole('button', { name: 'ОК' }));
  await waitFor(() => expect(adminApiMock.resetPassword).toHaveBeenCalledWith('ivanov'));
});

test('создание нового пользователя отправляет форму без логина', async () => {
  renderScreen();
  await screen.findByText('Иванов Иван');
  await userEvent.click(screen.getByRole('button', { name: 'Добавить' }));
  await userEvent.type(screen.getByLabelText('ФИО'), 'Петров Пётр');
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(adminApiMock.saveUser).toHaveBeenCalledWith(
    expect.objectContaining({ login: undefined, fio: 'Петров Пётр', role: 'user' })
  ));
});

test('кнопка «Добавить» скрыта не у суперадмина', async () => {
  session = { user: { id: 2, login: 'cb_ivanov', fio: 'C&B Иванов', role: 'cb', units: [], capabilities: ['users:view', 'users:edit'], onboarded: true, hasTelegram: true } } as unknown as SessionData;
  renderScreen();
  await screen.findByText('Иванов Иван');
  expect(screen.queryByRole('button', { name: 'Добавить' })).not.toBeInTheDocument();
});
