import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmHost } from '../../../design/Confirm';
import * as compApi from '../../../api/compReview';
import * as adminApiModule from '../../../api/admin';
import { CompCommitteeScreen } from './CompCommitteeScreen';

vi.mock('../../shell/Shell', () => ({ useScreenTitle: () => {} }));

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ConfirmHost><CompCommitteeScreen /></ConfirmHost></QueryClientProvider>);
}

function mockApi() {
  vi.spyOn(compApi.compReviewApi, 'committee').mockResolvedValue({ ok: true, rows: ['ivanov'] });
  vi.spyOn(compApi.compReviewApi, 'settings').mockResolvedValue({ ok: true, settings: { voteMode: 'closed' } });
  vi.spyOn(adminApiModule.adminApi, 'users').mockResolvedValue({
    ok: true,
    users: [
      { id: 1, login: 'ivanov', fio: 'Иванов Иван', role: 'hrbp', phone: '', position: '', units: [], active: true, lastIn: '', hasTelegram: false, hasPassword: true },
      { id: 2, login: 'petrov', fio: 'Петров Пётр', role: 'user', phone: '', position: '', units: [], active: true, lastIn: '', hasTelegram: false, hasPassword: true }
    ]
  });
  const add = vi.spyOn(compApi.compReviewApi, 'addCommitteeMember').mockResolvedValue({ ok: true });
  const remove = vi.spyOn(compApi.compReviewApi, 'removeCommitteeMember').mockResolvedValue({ ok: true });
  const saveSettings = vi.spyOn(compApi.compReviewApi, 'saveSettings').mockResolvedValue({ ok: true, settings: { voteMode: 'open' } });
  return { add, remove, saveSettings };
}

describe('CompCommitteeScreen', () => {
  // Узкий экран дублирует состав компактной таблицей (.tableCompact) — в
  // DOM (jsdom не считает media query) запись оказывается дважды, поэтому
  // проверки здесь scoped на первую (полную) таблицу.
  function fullTable() {
    return screen.getAllByRole('table')[0];
  }

  it('показывает состав и режим голосования', async () => {
    mockApi();
    renderScreen();
    await waitFor(() => expect(within(fullTable()).getByText('Иванов Иван')).toBeInTheDocument());
    expect(screen.getByDisplayValue(/Закрытое/)).toBeInTheDocument();
  });

  it('смена режима голосования сохраняет настройку', async () => {
    const { saveSettings } = mockApi();
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(within(fullTable()).getByText('Иванов Иван')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Режим голосования'), 'open');
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith('open'));
  });

  it('добавление и исключение членов комиссии', async () => {
    const { add, remove } = mockApi();
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(within(fullTable()).getByText('Иванов Иван')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Сотрудник'), 'Петров');
    await user.click(await screen.findByText('Петров Пётр (petrov)'));
    await user.click(screen.getByRole('button', { name: 'Добавить в комиссию' }));
    await waitFor(() => expect(add).toHaveBeenCalledWith('petrov'));

    await user.click(within(fullTable()).getByRole('button', { name: 'Исключить' }));
    await user.click(await screen.findByRole('button', { name: 'ОК' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('ivanov'));
  });
});
