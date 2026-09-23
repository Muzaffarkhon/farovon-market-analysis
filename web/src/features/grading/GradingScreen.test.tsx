import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { GradingScreen } from './GradingScreen';
import * as api from '../../api/grading';
import type { GradingBlock, GradingPositionsResponse } from '../../api/contract';

vi.mock('../shell/Shell', () => ({ useScreenTitle: () => {} }));

const blocks: GradingBlock[] = [
  { key: 'office', label: 'Офис', sort: 1, position_count: 5, evaluated_count: 2 },
  { key: 'production', label: 'Производство', sort: 2, position_count: 8, evaluated_count: 0 }
];

const positionsResponse: GradingPositionsResponse = {
  ok: true,
  block: { key: 'office', label: 'Офис' },
  committeeSize: 0, isCommitteeMember: false, factorCount: 7,
  rows: [{
    job_title: 'Бухгалтер', unit_count: 3, staff_count: 5, evaluation_id: null,
    factor_1: null, factor_2: null, factor_3: null, factor_4: null, factor_5: null, factor_6: null, factor_7: null,
    weighted_score: null, grade_level: null, evaluated_by: null, notes: null, updated_at: null,
    submitted_count: 0, units: []
  }]
};

let blocksFn: ReturnType<typeof vi.fn>;
let positionsFn: ReturnType<typeof vi.fn>;
let factorsFn: ReturnType<typeof vi.fn>;

function renderScreen(initial = '/grading') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes><Route path="/grading/:block?" element={<GradingScreen />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  blocksFn = vi.fn().mockResolvedValue({ ok: true, rows: blocks });
  positionsFn = vi.fn().mockResolvedValue(positionsResponse);
  factorsFn = vi.fn().mockResolvedValue({ ok: true, criteria: [], weights: [], maxGrade: 1, grades: [], riskFactors: [], riskLevels: [] });
  vi.spyOn(api, 'gradingApi', 'get').mockReturnValue({
    blocks: blocksFn, positions: positionsFn, factors: factorsFn, evaluate: vi.fn(), stats: vi.fn()
  } as never);
});

test('без блока в адресе показывает карточки блоков', async () => {
  renderScreen('/grading');
  expect(await screen.findByText('Офис')).toBeInTheDocument();
  expect(screen.getByText('Производство')).toBeInTheDocument();
});

test('клик по блоку загружает его должности', async () => {
  renderScreen('/grading');
  await userEvent.click(await screen.findByRole('link', { name: /Офис/ }));
  await screen.findByText(/должностей в блоке/);
  expect(positionsFn).toHaveBeenCalledWith('office');
});

test('блок из адреса открывается сразу', async () => {
  renderScreen('/grading/office');
  expect(await screen.findByText(/1 должностей в блоке «Офис»/)).toBeInTheDocument();
});
