import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DivisionsScreen } from './DivisionsScreen';
import * as adminApiModule from '../../../api/admin';
import type { SessionData } from '../../../api/contract';

vi.mock('../../shell/Shell', () => ({ useScreenTitle: () => {} }));

let session: SessionData;
vi.mock('../../auth/useSession', () => ({ useSessionData: () => session }));

const row = {
  id: 1, num: 1, dir: 'Дивизион', unit: 'Цех 1', level: null, head: 'Иванов', resp: 'Петров', hrbp: 'Сидоров',
  cnt: 5, note: '', group_key: null, region: null, org_role: null, is_survey_target: 1, is_hidden: 0, parent_unit: null
};

let adminApiMock: Record<string, ReturnType<typeof vi.fn>>;

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DivisionsScreen /></QueryClientProvider>);
}

beforeEach(() => {
  adminApiMock = {
    divisions: vi.fn().mockResolvedValue({ ok: true, divisions: [row], groupSuggestions: [] }),
    saveDivision: vi.fn().mockResolvedValue({ ok: true }),
    createDivision: vi.fn(), moveDivision: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    hideDivision: vi.fn(), deleteDivision: vi.fn(), batchAssign: vi.fn()
  };
  vi.spyOn(adminApiModule, 'adminApi', 'get').mockReturnValue(adminApiMock as never);
});

test('dir_head не видит «Создать» и «Удалить», но видит «Переместить»', async () => {
  session = { user: { role: 'dir_head', capabilities: ['divisions:edit'] } } as unknown as SessionData;
  renderScreen();
  await screen.findAllByText('Цех 1');
  expect(screen.queryByRole('button', { name: 'Создать' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Переместить' })).toBeInTheDocument();
});

test('dir_head в карточке подразделения видит поле «Направление» отключённым', async () => {
  session = { user: { role: 'dir_head', capabilities: ['divisions:edit'] } } as unknown as SessionData;
  renderScreen();
  const [row] = await screen.findAllByText('Цех 1');
  await userEvent.click(row);
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByLabelText('Направление')).toBeDisabled();
  expect(dialog.getByLabelText('Руководитель')).toBeEnabled();
});

test('admin видит все кнопки управления', async () => {
  session = { user: { role: 'admin', capabilities: [] } } as unknown as SessionData;
  renderScreen();
  await screen.findAllByText('Цех 1');
  expect(screen.getByRole('button', { name: 'Создать' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Массовое назначение' })).toBeInTheDocument();
});
