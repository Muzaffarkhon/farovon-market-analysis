import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BenchmarkImportWizard } from './BenchmarkImportWizard';
import * as benchmarkApiModule from '../../../api/benchmark';
import type { BenchmarkSource } from '../../../api/contract';

const sources: BenchmarkSource[] = [
  { key: 'internal', title: 'Внутренний сбор', kind: 'internal', is_licensed: 0, default_currency: 'сомони', notes: '', weight: 100, hidden: 0 },
  { key: 'ext1', title: 'Внешний консультант', kind: 'consultancy', is_licensed: 0, default_currency: 'сомони', notes: '', weight: 100, hidden: 0 }
];

let benchmarkApiMock: Record<string, ReturnType<typeof vi.fn>>;

function renderWizard(onClose = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><BenchmarkImportWizard sources={sources} onClose={onClose} /></QueryClientProvider>);
}

function mockXlsxFile() {
  const file = new File(['fake'], 'data.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(new TextEncoder().encode('fake').buffer) });
  return file;
}

beforeEach(() => {
  benchmarkApiMock = {
    xlsxSheets: vi.fn().mockResolvedValue({ ok: true, sheets: ['Лист1'] }),
    xlsxGrid: vi.fn().mockResolvedValue({ ok: true, rows: [['Должность', 'П25', 'П50', 'П75'], ['Бухгалтер', '5000', '6000', '7000']] }),
    importDryRun: vi.fn().mockResolvedValue({
      ok: true,
      report: {
        source: { key: 'ext1', title: 'Внешний консультант', isLicensed: false },
        headers: ['Должность', 'П25', 'П50', 'П75'], totalLines: 1, validRows: 1,
        newPositionsCount: 1, newPositionsList: ['Бухгалтер'], preview: [], errors: [], warnings: []
      }
    }),
    importCommit: vi.fn().mockResolvedValue({ ok: true, result: { datasetId: 1, datasetTitle: 'Тест', insertedRowsCount: 1 }, message: 'Датасет успешно импортирован' }),
    fx: vi.fn().mockResolvedValue({ ok: true, rate: 1, date: '2026-09-23', currencies: ['сомони'] })
  };
  vi.spyOn(benchmarkApiModule, 'benchmarkApi', 'get').mockReturnValue(benchmarkApiMock as never);
});

test('мастер не даёт подтвердить импорт, пока не выполнен dry-run', async () => {
  renderWizard();
  const input = document.getElementById('benchmark-xlsx-file') as HTMLInputElement;
  await userEvent.upload(input, mockXlsxFile());
  await waitFor(() => expect(screen.getByLabelText('Название должности *')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Подтвердить импорт' })).not.toBeInTheDocument();
});

test('после dry-run подтверждение вызывает commit с тем же источником и режимом', async () => {
  renderWizard();
  const input = document.getElementById('benchmark-xlsx-file') as HTMLInputElement;
  await userEvent.upload(input, mockXlsxFile());
  await waitFor(() => expect(screen.getByLabelText('Название должности *')).toBeInTheDocument());

  await userEvent.selectOptions(screen.getByLabelText('Название должности *'), '0');
  await userEvent.click(screen.getByRole('button', { name: 'Проверить файл' }));
  await screen.findByRole('button', { name: 'Подтвердить импорт' });
  await userEvent.click(screen.getByRole('button', { name: 'Подтвердить импорт' }));

  await waitFor(() => expect(benchmarkApiMock.importCommit).toHaveBeenCalled());
  expect(benchmarkApiMock.importCommit.mock.calls[0][0]).toMatchObject({ sourceKey: 'ext1', mode: 'percentiles' });
});
