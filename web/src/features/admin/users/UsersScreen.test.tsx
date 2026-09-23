import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsersScreen } from './UsersScreen';
import * as adminApiModule from '../../../api/admin';
import * as accessApiModule from '../../../api/access';

vi.mock('../../shell/Shell', () => ({ useScreenTitle: () => {} }));

const activeUser = {
  id: 1, login: 'ivanov', fio: 'Иванов Иван', role: 'user', phone: '', position: 'Мастер',
  units: ['Цех 1'], active: true, lastIn: '', hasTelegram: true, hasPassword: true
};

let adminApiMock: Record<string, ReturnType<typeof vi.fn>>;

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><UsersScreen /></QueryClientProvider>);
}

beforeEach(() => {
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
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
  renderScreen();
  await screen.findByText('Иванов Иван');
  await userEvent.click(screen.getByRole('checkbox', { name: /активен/ }));
  expect(confirmSpy).toHaveBeenCalled();
  expect(adminApiMock.toggleUser).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

test('подтверждённый сброс пароля вызывает API', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  renderScreen();
  await screen.findByText('Иванов Иван');
  await userEvent.click(screen.getByRole('button', { name: 'Сброс пароля' }));
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
