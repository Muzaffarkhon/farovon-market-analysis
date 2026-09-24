import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmHost } from '../../../design/Confirm';
import * as maintenanceApiModule from '../../../api/maintenance';
import { MergeDuplicates } from './MergeDuplicates';

function renderScreen(onClose = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ConfirmHost><MergeDuplicates kind="companies" onClose={onClose} /></ConfirmHost></QueryClientProvider>);
}

function mockApi() {
  vi.spyOn(maintenanceApiModule.maintenanceApi, 'companyUsage').mockResolvedValue({
    ok: true,
    companies: [
      { name: 'Амид', competitors: 2, surveys: 0, total: 2, inDictionary: true, segment: '', region: '' },
      { name: 'Амид групп', competitors: 5, surveys: 1, total: 6, inDictionary: false, segment: '', region: '' }
    ]
  });
  vi.spyOn(maintenanceApiModule.maintenanceApi, 'similarNames').mockResolvedValue({
    ok: true, kind: 'companies',
    pairs: [{ a: 'Амид', b: 'Амид групп', ratio: 0.9, reason: 'contains', aInfo: {}, bInfo: {} }]
  });
  const merge = vi.spyOn(maintenanceApiModule.maintenanceApi, 'mergeCompanies').mockResolvedValue({ ok: true, message: 'Объединено успешно' });
  return { merge };
}

describe('MergeDuplicates', () => {
  it('клик по подсказке «похоже» отмечает обе записи и показывает объединение', async () => {
    const { merge } = mockApi();
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(screen.getByText('2 участников рынка')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Амид групп' }));
    await waitFor(() => expect(screen.getByText(/Объединить 2 → 1/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Объединить 2 → 1/ }));
    const dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Объединить' }));

    await waitFor(() => expect(merge).toHaveBeenCalled());
    expect(merge.mock.calls[0][0]).toBe('Амид групп'); // основной — с большим total
    expect(merge.mock.calls[0][1]).toEqual(['Амид']);
  });
});
