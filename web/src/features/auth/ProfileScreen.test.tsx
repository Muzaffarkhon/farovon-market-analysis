import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmHost } from '../../design/Confirm';
import { authApi } from '../../api/auth';
import { telegramApi } from '../../api/telegram';
import type { SessionData } from '../../api/contract';
import { ProfileScreen } from './ProfileScreen';

vi.mock('../shell/Shell', () => ({ useScreenTitle: () => {} }));
vi.mock('../../api/auth', () => ({ authApi: { changeName: vi.fn(), resume: vi.fn() } }));
vi.mock('../../api/telegram', () => ({ telegramApi: { unlink: vi.fn(), link: vi.fn(), botInfo: vi.fn() } }));

let session: { user: SessionData['user'] };
const setData = vi.fn();
vi.mock('./useSession', () => ({
  useSession: () => ({ setData }),
  useSessionData: () => session
}));

function renderScreen() {
  return render(<ConfirmHost><ProfileScreen /></ConfirmHost>);
}

beforeEach(() => {
  session = { user: { id: 1, login: 'ivanov', fio: 'Иванов Иван', role: 'user', units: [], capabilities: [], onboarded: true, hasTelegram: false } };
  setData.mockClear();
});

test('изменение ФИО отправляет запрос и обновляет сессию', async () => {
  vi.mocked(authApi.changeName).mockResolvedValue({ ok: true, message: 'ФИО обновлено', data: { user: { ...session.user, fio: 'Иванов Пётр' } } as SessionData });
  const user = userEvent.setup();
  renderScreen();

  const input = screen.getByLabelText('ФИО');
  await user.clear(input);
  await user.type(input, 'Иванов Пётр');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));

  await waitFor(() => expect(authApi.changeName).toHaveBeenCalledWith('Иванов Пётр'));
  expect(setData).toHaveBeenCalled();
});

test('без привязки Telegram показана кнопка «Привязать Telegram»', () => {
  renderScreen();
  expect(screen.getByRole('button', { name: 'Привязать Telegram' })).toBeInTheDocument();
});

test('отвязка Telegram требует подтверждения', async () => {
  session.user.hasTelegram = true;
  vi.mocked(telegramApi.unlink).mockResolvedValue({ ok: true });
  vi.mocked(authApi.resume).mockResolvedValue({ ok: true, data: { user: { ...session.user, hasTelegram: false } } as SessionData });
  const user = userEvent.setup();
  renderScreen();

  await user.click(screen.getByRole('button', { name: 'Отвязать' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('button', { name: 'Отвязать' }));

  await waitFor(() => expect(telegramApi.unlink).toHaveBeenCalled());
});
