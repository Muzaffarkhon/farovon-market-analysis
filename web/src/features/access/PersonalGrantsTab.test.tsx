import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PersonalGrantsTab } from './PersonalGrantsTab';
import { accessApi } from '../../api/access';

vi.mock('../../api/access', () => ({ accessApi: { userCapabilities: vi.fn(), setUserCapabilities: vi.fn() } }));

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><PersonalGrantsTab /></QueryClientProvider>);
}

test('право по роли отмечено; клик отключает его лично', async () => {
  vi.mocked(accessApi.userCapabilities).mockResolvedValue({
    ok: true,
    capabilities: [{ id: 'survey:fill', resource: 'survey', resourceLabel: 'Сбор данных', label: 'Заполнение анкет' }],
    users: [{ login: 'ivanov', fio: 'Иванов И.', role: 'user', active: true }],
    grants: [],
    roleCapabilities: { user: ['survey:fill'] },
    roleLabels: { user: 'Сотрудник' }
  });
  vi.mocked(accessApi.setUserCapabilities).mockResolvedValue({ ok: true });
  renderTab();
  await userEvent.click(await screen.findByRole('button', { name: /Иванов/ }));
  const box = await screen.findByLabelText('Заполнение анкет');
  expect(box).toBeChecked();
  expect(screen.getByText('по роли')).toBeInTheDocument();
  await userEvent.click(box);
  expect(screen.getByText('отключено')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(accessApi.setUserCapabilities).toHaveBeenCalledWith({ userLogin: 'ivanov', capabilities: [], denied: ['survey:fill'], expiresAt: null });
});
