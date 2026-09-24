import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { UnitPickScreen } from './UnitPickScreen';
import { authApi } from '../../api/auth';
import type { SessionData } from '../../api/contract';

vi.mock('../../api/auth', () => ({ authApi: { setUnits: vi.fn() } }));

const session: SessionData = {
  user: { login: 'ivanov', fio: 'Иванов Иван', role: 'user', units: [], capabilities: [], onboarded: false, hasTelegram: false }
} as unknown as SessionData;

const setData = vi.fn();
vi.mock('./useSession', () => ({
  useSession: () => ({ data: session, setData }),
  useSessionData: () => ({
    ...session,
    allUnits: [{ unit: 'Цех 1', dir: 'Производство', group_key: '' }, { unit: 'Отдел продаж', dir: 'Коммерция', group_key: '' }]
  })
}));

test('выбор подразделений и отправка вызывает setUnits', async () => {
  vi.mocked(authApi.setUnits).mockResolvedValue({ ok: true, data: session });
  const user = userEvent.setup();
  render(<MemoryRouter><UnitPickScreen /></MemoryRouter>);

  expect(screen.getByRole('button', { name: 'Продолжить' })).toBeDisabled();

  await user.click(screen.getByText('Цех 1 — Производство'));
  expect(screen.getByRole('button', { name: 'Продолжить' })).toBeEnabled();

  await user.click(screen.getByRole('button', { name: 'Продолжить' }));
  expect(authApi.setUnits).toHaveBeenCalledWith(['Цех 1']);
});

test('поиск фильтрует список подразделений', async () => {
  vi.mocked(authApi.setUnits).mockResolvedValue({ ok: true, data: session });
  const user = userEvent.setup();
  render(<MemoryRouter><UnitPickScreen /></MemoryRouter>);

  await user.type(screen.getByLabelText('Поиск'), 'продаж');
  expect(screen.queryByText(/Цех 1/)).not.toBeInTheDocument();
  expect(screen.getByText(/Отдел продаж/)).toBeInTheDocument();
});
