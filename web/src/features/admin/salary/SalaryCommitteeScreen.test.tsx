import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmHost } from '../../../design/Confirm';
import * as salaryApiModule from '../../../api/salary';
import * as adminApiModule from '../../../api/admin';
import { SalaryCommitteeScreen } from './SalaryCommitteeScreen';

vi.mock('../../shell/Shell', () => ({ useScreenTitle: () => {} }));

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ConfirmHost><SalaryCommitteeScreen /></ConfirmHost></QueryClientProvider>);
}

function mockApi() {
  vi.spyOn(salaryApiModule.salaryApi, 'committee').mockResolvedValue({ ok: true, rows: ['ivanov'] });
  vi.spyOn(adminApiModule.adminApi, 'users').mockResolvedValue({
    ok: true,
    users: [
      { id: 1, login: 'ivanov', fio: 'Иванов Иван', role: 'hrbp', phone: '', position: '', units: [], active: true, lastIn: '', hasTelegram: false, hasPassword: true },
      { id: 2, login: 'petrov', fio: 'Петров Пётр', role: 'user', phone: '', position: '', units: [], active: true, lastIn: '', hasTelegram: false, hasPassword: true }
    ]
  });
  const add = vi.spyOn(salaryApiModule.salaryApi, 'addCommitteeMember').mockResolvedValue({ ok: true });
  const remove = vi.spyOn(salaryApiModule.salaryApi, 'removeCommitteeMember').mockResolvedValue({ ok: true });
  return { add, remove };
}

describe('SalaryCommitteeScreen', () => {
  it('показывает текущий состав и доступных для добавления', async () => {
    mockApi();
    renderScreen();
    await waitFor(() => expect(screen.getByText('Иванов Иван')).toBeInTheDocument());
  });

  it('исключение члена комиссии требует подтверждения', async () => {
    const { remove } = mockApi();
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(screen.getByText('Иванов Иван')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Исключить' }));
    await user.click(await screen.findByRole('button', { name: 'ОК' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('ivanov'));
  });

  it('добавление нового члена комиссии', async () => {
    const { add } = mockApi();
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(screen.getByText('Иванов Иван')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Сотрудник'), 'Петров');
    await user.click(await screen.findByText('Петров Пётр (petrov)'));
    await user.click(screen.getByRole('button', { name: 'Добавить в комиссию' }));

    await waitFor(() => expect(add).toHaveBeenCalledWith('petrov'));
  });
});
