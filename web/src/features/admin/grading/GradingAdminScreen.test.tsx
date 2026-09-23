import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GradingAdminScreen } from './GradingAdminScreen';
import * as gradingApiModule from '../../../api/grading';

vi.mock('../../shell/Shell', () => ({ useScreenTitle: () => {} }));

let gradingApiMock: Record<string, ReturnType<typeof vi.fn>>;

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><GradingAdminScreen /></QueryClientProvider>);
}

beforeEach(() => {
  gradingApiMock = {
    adminBlocks: vi.fn().mockResolvedValue({ ok: true, rows: [{ key: 'production', label: 'Производство', sort: 1, pair_count: 3 }, { key: 'unassigned', label: 'Не распределено', sort: 999, pair_count: 1 }] }),
    factors: vi.fn().mockResolvedValue({
      ok: true, weights: [], maxGrade: 5, grades: [], riskLevels: [],
      criteria: [{ code: 'К1', title: 'Вопрос 1', help: '', options: ['1', '2', '3', '4', '5'], examples: [] }],
      riskFactors: [{ code: 'Р1', title: 'Риск 1', help: '', options: ['1', '2', '3', '4', '5'], examples: [] }]
    }),
    saveFactor: vi.fn().mockResolvedValue({ ok: true }),
    resetFactor: vi.fn().mockResolvedValue({ ok: true }),
    adminBlockPositions: vi.fn().mockResolvedValue({ ok: true, rows: [{ unit: 'Цех 1', position: 'Мастер', staff_count: 4 }], total: 1 }),
    reassignBlockPosition: vi.fn().mockResolvedValue({ ok: true }),
    resetEvaluation: vi.fn().mockResolvedValue({ ok: true, message: 'Оценка сброшена' }),
    committee: vi.fn().mockResolvedValue({ ok: true, rows: [{ login: 'ivanov', fio: 'Иванов Иван', role: 'user' }] }),
    pendingCommittee: vi.fn().mockResolvedValue({ ok: true, committeeSize: 3, rows: [{ job_title: 'Мастер', submitted_count: 1 }] }),
    addCommitteeMember: vi.fn().mockResolvedValue({ ok: true }),
    removeCommitteeMember: vi.fn().mockResolvedValue({ ok: true }),
    finalizeCommittee: vi.fn().mockResolvedValue({ ok: true, message: 'Итог подведён вручную' })
  };
  vi.spyOn(gradingApiModule, 'gradingApi', 'get').mockReturnValue(gradingApiMock as never);
});

test('вкладки переключаются независимо', async () => {
  renderScreen();
  expect(await screen.findByText('Вопрос 1')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Блоки' }));
  expect(await screen.findByText('Мастер')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Комиссия' }));
  expect(await screen.findByText('Иванов Иван')).toBeInTheDocument();
});

test('сброс утверждённой оценки требует подтверждения', async () => {
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
  renderScreen();
  await userEvent.click(await screen.findByRole('button', { name: 'Блоки' }));
  await screen.findByText('Мастер');
  await userEvent.click(screen.getByRole('button', { name: 'Сбросить оценку' }));
  expect(confirmSpy).toHaveBeenCalled();
  expect(gradingApiMock.resetEvaluation).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

test('подтверждённое принудительное подведение итога вызывает finalize', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  renderScreen();
  await userEvent.click(await screen.findByRole('button', { name: 'Комиссия' }));
  await screen.findByText('Мастер');
  await userEvent.click(screen.getByRole('button', { name: 'Подвести итог принудительно' }));
  await waitFor(() => expect(gradingApiMock.finalizeCommittee).toHaveBeenCalledWith({ block: 'production', job_title: 'Мастер' }));
});
