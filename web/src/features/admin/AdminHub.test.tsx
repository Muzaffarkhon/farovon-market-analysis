import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AdminHub } from './AdminHub';
import type { SessionData } from '../../api/contract';

vi.mock('../shell/Shell', () => ({ useScreenTitle: () => {} }));

let session: SessionData;
vi.mock('../auth/useSession', () => ({ useSessionData: () => session }));

// AdminHub опрашивает /admin/support/unread-count для бейджа — мок вместо
// реальной сети, значение переопределяется по тестам через unreadCountMock.
const unreadCountMock = vi.fn(() => Promise.resolve({ ok: true, count: 0 }));
vi.mock('../../api/support', () => ({ supportApi: { unreadCount: () => unreadCountMock() } }));

function renderHub() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><AdminHub /></MemoryRouter></QueryClientProvider>);
}

test('видна только карточка раздела, на который есть право', () => {
  session = { user: { role: 'user', capabilities: ['users:view'] } } as unknown as SessionData;
  renderHub();
  expect(screen.getByText('Пользователи')).toBeInTheDocument();
  expect(screen.queryByText('Оргструктура')).not.toBeInTheDocument();
  expect(screen.queryByText('Роли и доступы')).not.toBeInTheDocument();
});

test('admin видит все карточки', () => {
  session = { user: { role: 'admin', capabilities: [] } } as unknown as SessionData;
  renderHub();
  expect(screen.getByText('Пользователи')).toBeInTheDocument();
  expect(screen.getByText('Оргструктура')).toBeInTheDocument();
  expect(screen.getByText('Роли и доступы')).toBeInTheDocument();
});

test('без единого права показана пустая подсказка', () => {
  session = { user: { role: 'user', capabilities: [] } } as unknown as SessionData;
  renderHub();
  expect(screen.getByText('Нет доступных разделов администрирования.')).toBeInTheDocument();
});

test('непрочитанные обращения показаны бейджем на карточке поддержки', async () => {
  unreadCountMock.mockResolvedValueOnce({ ok: true, count: 3 });
  session = { user: { role: 'admin', capabilities: [] } } as unknown as SessionData;
  renderHub();
  expect(await screen.findByText('3')).toBeInTheDocument();
});
