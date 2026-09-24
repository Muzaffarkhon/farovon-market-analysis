import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmHost } from '../../design/Confirm';
import * as salaryApiModule from '../../api/salary';
import type { SalaryRequest, SalaryStep } from '../../api/contract';
import { SalaryScreen } from './SalaryScreen';

vi.mock('../shell/Shell', () => ({ useScreenTitle: () => {} }));

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ConfirmHost><SalaryScreen /></ConfirmHost></QueryClientProvider>);
}

const reasons = [
  { code: 'benchmark' as const, label: 'Данные бенчмаркинга рынка' },
  { code: 'grading' as const, label: 'Результат грейдирования' }
];

const pendingRequest: SalaryRequest = {
  id: 5, unit: 'Бухгалтерия', fio: 'Иванов Иван', position: 'Бухгалтер',
  currentSalary: 8000, proposedSalary: 9000, proposedPercent: null,
  reasons: ['grading'], reasonText: '',
  status: 'pending', step: 'hrd',
  createdBy: 'hrbp1', createdAt: '2026-09-24 10:00:00', decidedAt: null
};

function mockApi(overrides: Partial<{ steps: SalaryStep[]; canRequest: boolean }> = {}) {
  vi.spyOn(salaryApiModule.salaryApi, 'myAccess').mockResolvedValue({
    ok: true, canRequest: overrides.canRequest ?? true, steps: overrides.steps ?? ['hrd']
  });
  vi.spyOn(salaryApiModule.salaryApi, 'reasons').mockResolvedValue({ ok: true, reasons });
  vi.spyOn(salaryApiModule.salaryApi, 'employees').mockResolvedValue({
    ok: true, rows: [{ id: 1, unit: 'Бухгалтерия', fio: 'Иванов Иван', position: 'Бухгалтер', currentSalary: 8000 }]
  });
  vi.spyOn(salaryApiModule.salaryApi, 'history').mockResolvedValue({ ok: true, rows: [] });
  const create = vi.spyOn(salaryApiModule.salaryApi, 'create').mockResolvedValue({ ok: true, request: pendingRequest });
  const queue = vi.spyOn(salaryApiModule.salaryApi, 'queue').mockResolvedValue({ ok: true, rows: [pendingRequest] });
  const decide = vi.spyOn(salaryApiModule.salaryApi, 'decide').mockResolvedValue({ ok: true, request: { ...pendingRequest, status: 'approved' } });
  return { create, queue, decide };
}

describe('SalaryScreen', () => {
  it('показывает вкладки по доступу пользователя', async () => {
    mockApi();
    renderScreen();
    await waitFor(() => expect(screen.getByText('Новая заявка')).toBeInTheDocument());
    expect(screen.getByText(/На согласовании — HRD/)).toBeInTheDocument();
    expect(screen.getByText('История окладов')).toBeInTheDocument();
  });

  it('без доступа к заявкам и очередям остаётся только история', async () => {
    mockApi({ canRequest: false, steps: [] });
    renderScreen();
    await waitFor(() => expect(screen.getByText('История окладов')).toBeInTheDocument());
    expect(screen.queryByText('Новая заявка')).not.toBeInTheDocument();
  });

  it('новая заявка: выбор сотрудника, сумма, основание — отправка вызывает create', async () => {
    const { create } = mockApi();
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(screen.getByText('Новая заявка')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Сотрудник'), 'Иванов');
    await waitFor(() => expect(screen.getByText('Иванов Иван')).toBeInTheDocument());
    await user.click(screen.getByText('Иванов Иван'));

    await user.type(screen.getByLabelText('Новый оклад суммой'), '9000');
    await user.click(screen.getByText('Результат грейдирования'));
    await user.click(screen.getByRole('button', { name: 'Отправить на согласование' }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toEqual({
      unit: 'Бухгалтерия', fio: 'Иванов Иван', position: 'Бухгалтер',
      proposedSalary: 9000, proposedPercent: undefined,
      reasons: ['grading'], reasonText: undefined
    });
  });

  it('очередь HRD: согласование вызывает decide с approved', async () => {
    const { decide } = mockApi();
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(screen.getByText(/На согласовании — HRD/)).toBeInTheDocument());
    await user.click(screen.getByText(/На согласовании — HRD/));

    await waitFor(() => expect(screen.getByText('Иванов Иван')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Согласовать' }));

    await waitFor(() => expect(decide).toHaveBeenCalledWith(5, { step: 'hrd', decision: 'approved', comment: undefined }));
  });
});
