import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmHost } from '../../../design/Confirm';
import * as dictApiModule from '../../../api/dictionary';
import type { SessionData } from '../../../api/contract';
import { DictionaryScreen } from './DictionaryScreen';

vi.mock('../../shell/Shell', () => ({ useScreenTitle: () => {} }));

let session: SessionData;
vi.mock('../../auth/useSession', () => ({ useSessionData: () => session }));

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ConfirmHost><DictionaryScreen /></ConfirmHost></QueryClientProvider>);
}

function mockApi() {
  const list = vi.spyOn(dictApiModule.dictionaryApi, 'list').mockImplementation(kind => {
    if (kind === 'companies') return Promise.resolve({
      ok: true, kind, dirs: ['Розница'],
      items: [{ name: 'Амид групп', code: '', segment: 'FMCG', region: 'Душанбе', dirs: ['Розница'], used: 3 }]
    });
    return Promise.resolve({ ok: true, kind, dirs: [], items: [] });
  });
  const usage = vi.spyOn(dictApiModule.dictionaryApi, 'usage').mockResolvedValue({ ok: true, name: 'Амид групп', total: 3, parts: ['3 строки участников рынка'] });
  const remove = vi.spyOn(dictApiModule.dictionaryApi, 'remove').mockResolvedValue({ ok: true, removed: 'Амид групп', total: 3, parts: ['3 строки участников рынка'] });
  return { list, usage, remove };
}

describe('DictionaryScreen', () => {
  beforeEach(() => {
    session = { user: { login: 'admin', role: 'admin', capabilities: [] } } as unknown as SessionData;
  });

  it('показывает записи справочника компаний', async () => {
    mockApi();
    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Амид групп' })).toBeInTheDocument());
    expect(screen.getByText('FMCG')).toBeInTheDocument();
  });

  it('переключение вкладки грузит другой справочник', async () => {
    const { list } = mockApi();
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Амид групп' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Должности' }));
    await waitFor(() => expect(list).toHaveBeenCalledWith('positions'));
  });

  it('удаление показывает объём использования и требует подтверждения', async () => {
    const { usage, remove } = mockApi();
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Амид групп' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(usage).toHaveBeenCalledWith('companies', 'Амид групп'));
    await waitFor(() => expect(screen.getByText(/3 строки участников рынка/)).toBeInTheDocument());

    const dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('companies', 'Амид групп'));
  });
});
