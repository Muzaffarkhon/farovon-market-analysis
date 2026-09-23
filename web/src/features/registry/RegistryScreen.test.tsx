import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { RegistryScreen } from './RegistryScreen';
import * as api from '../../api/registry';
import type { RegistryResponse, RegistryRow, SessionData } from '../../api/contract';

vi.mock('../shell/Shell', () => ({ useScreenTitle: () => {} }));

const session = {
  user: { role: 'cb', capabilities: ['dashboard:view', 'survey:fill'] }
} as unknown as SessionData;
vi.mock('../auth/useSession', () => ({ useSessionData: () => session }));

const row = (over: Partial<RegistryRow> = {}): RegistryRow => ({
  id: 's1', date: '2026-09-01 10:00:00', by: 'hrbp1',
  dir: 'Дивизион Север', hrbp: 'Иванов И.', unit: 'Цех 1', region: 'Худжанд',
  company: 'Алиф', posOur: 'Токарь', posTheir: 'Токарь 3р', grade: 'G7',
  payFrom: 3000, payTo: 5000, cur: 'сомони', payPer: 'в месяц',
  bonHas: 'нет', bonuses: [], varPay: { has: false, label: 'без премии' },
  benefits: ['ДМС'], extra: '', schedule: '5/2 · 40 часов',
  source: 'Интервью', trust: 'высокая', note: '', ...over
});

const answer = (over: Partial<RegistryResponse> = {}): RegistryResponse => ({
  ok: true, rows: [row()], total: 1, totalAll: 1, unmapped: 0,
  page: 1, pages: 1, perPage: 50,
  facets: {
    dirs: ['Дивизион Север'], hrbps: ['Иванов И.'], regions: ['Худжанд'], units: ['Цех 1'],
    companies: ['Алиф', 'Сиёма'], sources: ['Интервью'], trusts: ['высокая'],
    schedules: ['5/2 · 40 часов'], currencies: ['сомони'], grades: ['G7']
  },
  scoped: false, period: { id: 1, name: '2026' }, ...over
});

let lastSearch = '';
function SpyLocation() {
  lastSearch = useLocation().search;
  return null;
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/registry']}>
        <Routes><Route path="/registry" element={<><RegistryScreen /><SpyLocation /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

let list: ReturnType<typeof vi.fn>;
/** Все фильтры — в панели за кнопкой «Фильтры». */
const openFilters = () => userEvent.click(screen.getByRole('button', { name: /^Фильтры/ }));

beforeEach(() => {
  lastSearch = '';
  list = vi.fn().mockResolvedValue(answer());
  vi.spyOn(api, 'registryApi', 'get').mockReturnValue({ list } as never);
});

test('показывает собранные наблюдения таблицей', async () => {
  renderScreen();
  expect(await screen.findByRole('cell', { name: 'Алиф' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'Токарь' })).toBeInTheDocument();
  expect(screen.getByText('1 записей')).toBeInTheDocument();
});

test('колонки надёжности, источника и графика есть в таблице', async () => {
  renderScreen();
  await screen.findByRole('cell', { name: 'Алиф' });
  expect(screen.getByRole('columnheader', { name: /Надёжность/ })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /Источник/ })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /График/ })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /Грейд/ })).toBeInTheDocument();
});

test('выбор фильтра уходит в запрос и в адрес', async () => {
  renderScreen();
  await screen.findByRole('cell', { name: 'Алиф' });
  await openFilters();
  await userEvent.selectOptions(screen.getByLabelText('Компания'), 'Сиёма');
  await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ company: 'Сиёма' })));
  expect(lastSearch).toContain('company=%D0%A1');
});

test('поиск уходит одним запросом, а не на каждую букву', async () => {
  renderScreen();
  await screen.findByRole('cell', { name: 'Алиф' });
  await userEvent.type(screen.getByLabelText('Поиск'), 'алиф');
  // Пока идёт набор, запрос не уходит — иначе каждая буква дёргает сервер.
  expect(list).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'алиф' })));
  expect(list).toHaveBeenCalledTimes(2);
});

test('клик по заголовку сортирует и переворачивает порядок', async () => {
  renderScreen();
  await screen.findByRole('cell', { name: 'Алиф' });
  await userEvent.click(screen.getByRole('button', { name: /Компания/ }));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'company', order: 'desc' })));
  await userEvent.click(screen.getByRole('button', { name: /Компания/ }));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'company', order: 'asc' })));
});

test('страницы листаются', async () => {
  list.mockResolvedValue(answer({ total: 120, totalAll: 120, pages: 3 }));
  renderScreen();
  await screen.findByRole('cell', { name: 'Алиф' });
  expect(screen.getByText('Страница 1 из 3')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Вперёд' }));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
});

test('клик по строке открывает карточку наблюдения', async () => {
  list.mockResolvedValue(answer({ rows: [row({ note: 'уточнено у HR', benefits: ['ДМС', 'Обеды'] })] }));
  renderScreen();
  await userEvent.click(await screen.findByRole('cell', { name: 'Алиф' }));
  const card = await screen.findByRole('dialog', { name: 'Алиф' });
  expect(within(card).getByText('уточнено у HR')).toBeInTheDocument();
  expect(within(card).getByText('Обеды')).toBeInTheDocument();
  await userEvent.click(within(card).getByRole('button', { name: 'Закрыть' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('из карточки можно перейти к анкете', async () => {
  renderScreen();
  await userEvent.click(await screen.findByRole('cell', { name: 'Алиф' }));
  const card = await screen.findByRole('dialog', { name: 'Алиф' });
  expect(within(card).getByRole('button', { name: 'Открыть анкету' })).toBeInTheDocument();
});

test('пусто без фильтров и пусто с фильтрами — разные сообщения', async () => {
  list.mockResolvedValue(answer({ rows: [], total: 0, totalAll: 0 }));
  const { unmount } = renderScreen();
  expect(await screen.findByText('За этот период ещё ничего не собрано.')).toBeInTheDocument();
  unmount();

  list.mockResolvedValue(answer({ rows: [], total: 0, totalAll: 12 }));
  renderScreen();
  await openFilters();
  await screen.findAllByRole('option', { name: 'Сиёма' });
  await userEvent.selectOptions(screen.getByLabelText('Компания'), 'Сиёма');
  expect(await screen.findByText(/Ничего не найдено/)).toBeInTheDocument();
});

test('сброс убирает все фильтры', async () => {
  renderScreen();
  await openFilters();
  await screen.findAllByRole('option', { name: 'Сиёма' });
  await userEvent.selectOptions(screen.getByLabelText('Компания'), 'Сиёма');
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Фильтры' })).getByRole('button', { name: 'Сбросить' }));
  await waitFor(() => expect(lastSearch).toBe(''));
});

test('ограниченной роли сказано, что видны только свои подразделения', async () => {
  list.mockResolvedValue(answer({ scoped: true }));
  renderScreen();
  expect(await screen.findByText('Показаны только ваши подразделения')).toBeInTheDocument();
});

test('несопоставленные помечены и фильтруются', async () => {
  list.mockResolvedValue(answer({ rows: [row({ posOur: '(не сопоставлено)' })], unmapped: 1 }));
  renderScreen();
  expect(await screen.findByText('не сопоставлено')).toBeInTheDocument();
  await openFilters();
  await userEvent.click(screen.getByRole('button', { name: /Только несопоставленные/ }));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ onlyUnmapped: true })));
});

test('кнопка «Фильтры» открывает панель со всеми фильтрами', async () => {
  renderScreen();
  await screen.findByRole('cell', { name: 'Алиф' });
  expect(screen.queryByLabelText('Компания')).not.toBeInTheDocument();
  await openFilters();
  const panel = screen.getByRole('dialog', { name: 'Фильтры' });
  for (const label of ['Направление', 'Подразделение', 'Регион', 'Компания', 'Грейд', 'График', 'Источник', 'Надёжность', 'Валюта', 'HR BP']) {
    expect(within(panel).getByLabelText(label)).toBeInTheDocument();
  }
  expect(within(panel).getByRole('button', { name: /Только с окладом/ })).toBeInTheDocument();
});

test('выбранный фильтр виден над таблицей и снимается одним нажатием', async () => {
  renderScreen();
  await screen.findByRole('cell', { name: 'Алиф' });
  await openFilters();
  await userEvent.selectOptions(screen.getByLabelText('Компания'), 'Сиёма');
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Фильтры' })).getByRole('button', { name: /^Показать/ }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: /Компания: Сиёма/ }));
  await waitFor(() => expect(lastSearch).not.toContain('company='));
});
