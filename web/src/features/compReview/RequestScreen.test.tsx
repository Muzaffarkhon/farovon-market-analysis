import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmHost } from '../../design/Confirm';
import * as api from '../../api/compReview';
import type { CompRequest, SessionData } from '../../api/contract';
import { RequestScreen } from './RequestScreen';

vi.mock('../shell/Shell', () => ({ useScreenTitle: () => {} }));

let session: SessionData;
vi.mock('../auth/useSession', () => ({ useSessionData: () => session }));

function renderScreen(id = 5) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConfirmHost>
        <MemoryRouter initialEntries={[`/comp/${id}`]}>
          <Routes><Route path="/comp/:id" element={<RequestScreen />} /></Routes>
        </MemoryRouter>
      </ConfirmHost>
    </QueryClientProvider>
  );
}

const baseAccess = { ok: true as const, canSubmit: true, canReviewCb: false, canApproveHrd: false, canVoteCap: false, canPayroll: false, isAdmin: false, isCommitteeMember: false };
const reasonsResponse = {
  ok: true as const,
  requestTypes: [{ code: 'planned', label: 'Плановый пересмотр' }],
  reasons: [{ code: 'promotion', label: 'Повышение' }]
};

function draftRequest(): CompRequest {
  return {
    id: 5, initiatorLogin: 'dev.hrbp', unit: 'Бухгалтерия', requestType: 'planned',
    effectiveDate: '2026-10-01', basisDocument: '', comment: '', status: 'draft',
    committeeSize: 0, createdAt: '2026-09-24 10:00:00', updatedAt: '2026-09-24 10:00:00',
    employees: [], activity: [{ id: 1, employeeFio: null, actorLogin: 'dev.hrbp', action: 'создал черновик', comment: '', createdAt: '2026-09-24 10:00:00' }]
  };
}

describe('RequestScreen — черновик', () => {
  beforeEach(() => {
    session = { user: { login: 'dev.hrbp', role: 'hrbp', capabilities: ['comp:submit'] } } as unknown as SessionData;
  });

  it('автор видит форму добавления сотрудника и может отправить заявку', async () => {
    vi.spyOn(api.compReviewApi, 'myAccess').mockResolvedValue(baseAccess);
    vi.spyOn(api.compReviewApi, 'reasons').mockResolvedValue(reasonsResponse);
    const getFn = vi.spyOn(api.compReviewApi, 'get').mockResolvedValue({ ok: true, request: draftRequest() });
    vi.spyOn(api.compReviewApi, 'employees').mockResolvedValue({
      ok: true, rows: [{ id: 1, unit: 'Бухгалтерия', fio: 'Иванов Иван', position: 'Бухгалтер', lastReviewDate: null, currentSalary: 8000 }]
    });
    const addEmployee = vi.spyOn(api.compReviewApi, 'addEmployee').mockResolvedValue({ ok: true, request: draftRequest() });

    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(getFn).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Добавить сотрудника')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Добавить сотрудника'), 'Иванов');
    await waitFor(() => expect(screen.getByText('Иванов Иван')).toBeInTheDocument());
    await user.click(screen.getByText('Иванов Иван'));

    await user.type(screen.getByLabelText('Предлагаемый оклад'), '9000');
    await user.click(screen.getByText('Повышение'));
    await user.click(screen.getByRole('button', { name: 'Добавить в заявку' }));

    await waitFor(() => expect(addEmployee).toHaveBeenCalledWith(5, {
      fio: 'Иванов Иван', unit: 'Бухгалтерия', position: 'Бухгалтер', staffId: 1,
      proposedSalary: 9000, reasonCode: 'promotion', reasonText: undefined
    }));
  });

  it('без сотрудников кнопка отправки заблокирована', async () => {
    vi.spyOn(api.compReviewApi, 'myAccess').mockResolvedValue(baseAccess);
    vi.spyOn(api.compReviewApi, 'reasons').mockResolvedValue(reasonsResponse);
    vi.spyOn(api.compReviewApi, 'get').mockResolvedValue({ ok: true, request: draftRequest() });
    vi.spyOn(api.compReviewApi, 'employees').mockResolvedValue({ ok: true, rows: [] });

    renderScreen();
    await waitFor(() => expect(screen.getByText('В заявке пока нет сотрудников')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Отправить на проверку C&B' })).toBeDisabled();
  });
});

describe('RequestScreen — HRD согласование', () => {
  beforeEach(() => {
    session = { user: { login: 'hrd1', role: 'user', capabilities: ['comp:approve_hrd'] } } as unknown as SessionData;
  });

  it('HRD видит «Согласовать» и «Отклонить» на этапе hrd_review', async () => {
    vi.spyOn(api.compReviewApi, 'myAccess').mockResolvedValue({ ...baseAccess, canSubmit: false, canApproveHrd: true });
    vi.spyOn(api.compReviewApi, 'reasons').mockResolvedValue(reasonsResponse);
    const hrdApprove = vi.spyOn(api.compReviewApi, 'hrdApprove').mockResolvedValue({ ok: true, request: draftRequest() });
    vi.spyOn(api.compReviewApi, 'get').mockResolvedValue({
      ok: true,
      request: { ...draftRequest(), status: 'hrd_review', initiatorLogin: 'dev.hrbp' }
    });

    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Согласовать' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Согласовать' }));
    await waitFor(() => expect(hrdApprove).toHaveBeenCalled());
  });
});
