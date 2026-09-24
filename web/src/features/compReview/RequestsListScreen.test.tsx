import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import * as api from '../../api/compReview';
import type { CompRequest, CompRequestListItem } from '../../api/contract';
import { RequestsListScreen } from './RequestsListScreen';

vi.mock('../shell/Shell', () => ({ useScreenTitle: () => {} }));

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/comp']}>
        <Routes>
          <Route path="/comp" element={<RequestsListScreen />} />
          <Route path="/comp/:id" element={<div>DETAIL SCREEN</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const listItem: CompRequestListItem = {
  id: 7, initiatorLogin: 'dev.hrbp', unit: 'Бухгалтерия', requestType: 'planned',
  effectiveDate: '2026-10-01', basisDocument: '', comment: 'плановая индексация',
  status: 'cb_review', committeeSize: 0, createdAt: '2026-09-24 10:00:00', updatedAt: '2026-09-24 10:00:00'
};

function mockApi() {
  vi.spyOn(api.compReviewApi, 'myAccess').mockResolvedValue({
    ok: true, canSubmit: true, canReviewCb: false, canApproveHrd: false, canVoteCap: false, canPayroll: false, isAdmin: false, isCommitteeMember: false
  });
  vi.spyOn(api.compReviewApi, 'reasons').mockResolvedValue({
    ok: true,
    requestTypes: [{ code: 'planned', label: 'Плановый пересмотр' }],
    reasons: [{ code: 'promotion', label: 'Повышение' }]
  });
  const list = vi.spyOn(api.compReviewApi, 'list').mockResolvedValue({ ok: true, rows: [listItem] });
  const createDraft = vi.spyOn(api.compReviewApi, 'createDraft').mockResolvedValue({ ok: true, request: { id: 9 } as CompRequest });
  return { list, createDraft };
}

describe('RequestsListScreen', () => {
  it('показывает заявки и переключает вкладки', async () => {
    mockApi();
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(screen.getByText(/#7/)).toBeInTheDocument());
    expect(screen.getByText(/плановая индексация/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Мои' }));
    await waitFor(() => expect(api.compReviewApi.list).toHaveBeenLastCalledWith('mine'));
  });

  it('«+ Новая заявка» создаёт черновик и переходит к нему', async () => {
    const { createDraft } = mockApi();
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Новая заявка' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '+ Новая заявка' }));
    await waitFor(() => expect(createDraft).toHaveBeenCalledWith({ requestType: 'planned' }));
    await waitFor(() => expect(screen.getByText('DETAIL SCREEN')).toBeInTheDocument());
  });

  it('без права comp:submit кнопки создания заявки нет', async () => {
    vi.spyOn(api.compReviewApi, 'myAccess').mockResolvedValue({
      ok: true, canSubmit: false, canReviewCb: false, canApproveHrd: false, canVoteCap: false, canPayroll: false, isAdmin: false, isCommitteeMember: false
    });
    vi.spyOn(api.compReviewApi, 'reasons').mockResolvedValue({ ok: true, requestTypes: [], reasons: [] });
    vi.spyOn(api.compReviewApi, 'list').mockResolvedValue({ ok: true, rows: [] });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Заявок нет')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '+ Новая заявка' })).not.toBeInTheDocument();
  });
});
