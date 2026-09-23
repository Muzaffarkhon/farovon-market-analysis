import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AdminHub } from './AdminHub';
import type { SessionData } from '../../api/contract';

vi.mock('../shell/Shell', () => ({ useScreenTitle: () => {} }));

let session: SessionData;
vi.mock('../auth/useSession', () => ({ useSessionData: () => session }));

function renderHub() {
  return render(<MemoryRouter><AdminHub /></MemoryRouter>);
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
