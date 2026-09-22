import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { LoginScreen } from './LoginScreen';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';

vi.mock('../../api/auth', () => ({ authApi: { login: vi.fn() } }));
vi.mock('./useSession', () => ({ useSession: () => ({ setData: vi.fn() }) }));

test('ошибка сервера показывается под формой', async () => {
  vi.mocked(authApi.login).mockRejectedValue(new ApiError(401, 'Неверный логин или пароль'));
  render(<MemoryRouter><LoginScreen /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Логин'), 'u');
  await userEvent.type(screen.getByLabelText('Пароль'), 'p');
  await userEvent.click(screen.getByRole('button', { name: 'Войти' }));
  expect(await screen.findByText('Неверный логин или пароль')).toBeInTheDocument();
});
