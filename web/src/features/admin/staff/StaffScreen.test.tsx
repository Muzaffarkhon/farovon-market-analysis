import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StaffScreen } from './StaffScreen';
import * as adminApiModule from '../../../api/admin';

vi.mock('../../shell/Shell', () => ({ useScreenTitle: () => {} }));

const record = { id: 1, unit: 'Цех 1', fio: 'Иванов Иван', position: 'Мастер' };

let adminApiMock: Record<string, ReturnType<typeof vi.fn>>;

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><StaffScreen /></QueryClientProvider>);
}

beforeEach(() => {
  adminApiMock = {
    staffDirectory: vi.fn().mockResolvedValue({ ok: true, items: [record], importedAt: '2026-09-01' }),
    saveStaffRecord: vi.fn().mockResolvedValue({ ok: true, id: 2 }),
    deleteStaffRecord: vi.fn().mockResolvedValue({ ok: true }),
    importStaffDirectoryDryRun: vi.fn().mockResolvedValue({
      ok: true, dryRun: true,
      report: { rowsInFile: 3, rowsPrepared: 2, rowsSkipped: 1, skippedRows: [], units: 1, unmatchedUnits: [], unmatchedCount: 0 }
    }),
    importStaffDirectoryCommit: vi.fn().mockResolvedValue({ ok: true, message: 'Справочник обновлён' })
  };
  vi.spyOn(adminApiModule, 'adminApi', 'get').mockReturnValue(adminApiMock as never);
});

test('таблица показывает запись из ответа API', async () => {
  renderScreen();
  expect(await screen.findByText('Иванов Иван')).toBeInTheDocument();
});

function mockFile(text: string) {
  const file = new File([text], 'staff.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
  return file;
}

test('мастер импорта не отправляет commit, пока не выполнен dry-run', async () => {
  renderScreen();
  await screen.findByText('Иванов Иван');
  await userEvent.click(screen.getByRole('button', { name: 'Импорт из 1С' }));
  const input = screen.getByLabelText('Файл CSV') as HTMLInputElement;
  await userEvent.upload(input, mockFile('Должность,Подразделение организации,ФИО (полное)\nМастер,Цех 1,Иванов Иван\n'));
  expect(screen.queryByRole('button', { name: 'Подтвердить импорт' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Проверить файл' }));
  expect(await screen.findByRole('button', { name: 'Подтвердить импорт' })).toBeInTheDocument();
  expect(adminApiMock.importStaffDirectoryCommit).not.toHaveBeenCalled();
});

test('после dry-run подтверждение вызывает commit с тем же файлом', async () => {
  renderScreen();
  await screen.findByText('Иванов Иван');
  await userEvent.click(screen.getByRole('button', { name: 'Импорт из 1С' }));
  const input = screen.getByLabelText('Файл CSV') as HTMLInputElement;
  const csv = 'Должность,Подразделение организации,ФИО (полное)\nМастер,Цех 1,Иванов Иван\n';
  await userEvent.upload(input, mockFile(csv));
  await userEvent.click(screen.getByRole('button', { name: 'Проверить файл' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Подтвердить импорт' }));
  await waitFor(() => expect(adminApiMock.importStaffDirectoryCommit).toHaveBeenCalledWith(csv));
});
