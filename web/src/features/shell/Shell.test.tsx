import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { Shell } from './Shell';
import type { SessionData } from '../../api/contract';

const session = {
  user: { id: 1, login: 'u', fio: 'Пользователь', role: 'admin', capabilities: [], units: [], onboarded: true, hasTelegram: false },
  period: { id: 1, name: '2026', state: 'открыт' },
  myPeriodGrants: []
} as unknown as SessionData;
vi.mock('../auth/useSession', () => ({
  useSessionData: () => session,
  useSession: () => ({ logout: vi.fn() })
}));

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <Shell><div>содержимое экрана</div></Shell>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function mockViewport(isDesktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isDesktop, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn()
  })) as never;
}

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* noop */ }
});

test('пункты меню видны в боковой панели', () => {
  mockViewport(true);
  renderShell();
  expect(screen.getByRole('link', { name: 'Реестр' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Администрирование' })).toBeInTheDocument();
});

test('на широком экране кнопка «Разделы» сворачивает панель и запоминает это', async () => {
  mockViewport(true);
  renderShell();
  const toggle = screen.getByRole('button', { name: 'Разделы' });
  await userEvent.click(toggle);
  expect(window.localStorage.getItem('nav-collapsed')).toBe('1');
  await userEvent.click(toggle);
  expect(window.localStorage.getItem('nav-collapsed')).toBe('0');
});

test('на телефоне кнопка «Разделы» открывает выдвижное меню, клик по пункту его закрывает', async () => {
  mockViewport(false);
  renderShell();
  const toggle = screen.getByRole('button', { name: 'Разделы' });
  const registryLink = screen.getByRole('link', { name: 'Реестр' });
  expect(registryLink.closest('nav')?.className).not.toMatch(/\bopen\b/);
  await userEvent.click(toggle);
  expect(registryLink.closest('nav')?.className).toMatch(/\bopen\b/);
  await userEvent.click(registryLink);
  expect(registryLink.closest('nav')?.className).not.toMatch(/\bopen\b/);
});

test('кнопка «Обновить» есть в шапке', () => {
  mockViewport(true);
  renderShell();
  expect(screen.getByRole('button', { name: 'Обновить' })).toBeInTheDocument();
});
