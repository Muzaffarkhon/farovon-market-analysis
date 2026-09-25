import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { RegistryScreen } from './RegistryScreen';
import * as api from '../../api/registry';
import * as tablePrefsApiModule from '../../api/tablePrefs';
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
  bonHas: 'нет', bonuses: [], varPay: { has: false, label: 'без премии', monthly: null }, totalMonthly: 4000,
  benefits: ['ДМС'], extra: '', schedule: '5/2 · 40 часов',
  source: 'Интервью', trust: 'высокая', note: '', recordSource: 'manual', ...over
});

const answer = (over: Partial<RegistryResponse> = {}): RegistryResponse => ({
  ok: true, rows: [row()], total: 1, totalAll: 1, unmapped: 0,
  page: 1, pages: 1, perPage: 50,
  facets: {
    dirs: ['Дивизион Север'], hrbps: ['Иванов И.'], regions: ['Худжанд'], units: ['Цех 1'],
    companies: ['Алиф', 'Сиёма'], sources: ['Интервью'], trusts: ['высокая'],
    schedules: ['5/2 · 40 часов'], currencies: ['сомони'], grades: ['G7'], recordSources: ['manual', 'import']
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
let saveTablePrefs: ReturnType<typeof vi.fn>;
/** Все фильтры — в панели за кнопкой «Фильтры». */
const openFilters = () => userEvent.click(screen.getByRole('button', { name: /^Фильтры/ }));
/** Компания/подразделение — Combobox (поиск), не нативный select. */
async function pickCombo(label: string, optionName: string) {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.click(await screen.findByRole('option', { name: optionName }));
}

beforeEach(() => {
  lastSearch = '';
  list = vi.fn().mockResolvedValue(answer());
  vi.spyOn(api, 'registryApi', 'get').mockReturnValue({ list } as never);
  saveTablePrefs = vi.fn().mockImplementation((_key, columns) => Promise.resolve({ ok: true, columns }));
  vi.spyOn(tablePrefsApiModule, 'tablePrefsApi', 'get').mockReturnValue({
    get: vi.fn().mockResolvedValue({ ok: true, columns: null }),
    save: saveTablePrefs
  } as never);
});

test('показывает собранные наблюдения таблицей', async () => {
  renderScreen();
  expect(await screen.findByRole('cell', { name: 'Алиф' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'Токарь' })).toBeInTheDocument();
  expect(screen.getByText('1 записей')).toBeInTheDocument();
});

test('«Колонки» скрывает и снова показывает колонку, сохраняя выбор на сервере', async () => {
  renderScreen();
  await screen.findByRole('cell', { name: 'Алиф' });
  expect(screen.getByRole('columnheader', { name: /Грейд/ })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Колонки' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Грейд' }));

  await waitFor(() => expect(screen.queryByRole('columnheader', { name: /Грейд/ })).not.toBeInTheDocument());
  expect(saveTablePrefs).toHaveBeenLastCalledWith('registry', expect.not.arrayContaining(['grade']));

  await userEvent.click(screen.getByRole('checkbox', { name: 'Грейд' }));
  await waitFor(() => expect(screen.getByRole('columnheader', { name: /Грейд/ })).toBeInTheDocument());
  expect(saveTablePrefs).toHaveBeenLastCalledWith('registry', expect.arrayContaining(['grade']));
});

test('колонки надёжности, источника и графика есть в таблице', async () => {
  renderScreen();
  await screen.findByRole('cell', { name: 'Алиф' });
  expect(screen.getByRole('columnheader', { name: /Надёжность/ })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /^Источник↑?↓?$/ })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /Источник записи/ })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /^Комментарий/ })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /Прочие выплаты/ })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /График/ })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /Грейд/ })).toBeInTheDocument();
});

test('выбор фильтра уходит в запрос и в адрес', async () => {
  renderScreen();
  await screen.findByRole('cell', { name: 'Алиф' });
  await openFilters();
  await pickCombo('Компания', 'Сиёма');
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

test('каждая колонка таблицы сортируется', async () => {
  renderScreen();
  // 18 колонок кликаются последовательно — под нагрузкой полного прогона
  // (все файлы вместе) дефолтный таймаут может не хватить.
  await screen.findByRole('cell', { name: 'Алиф' });
  const sortKeys: Record<string, string> = {
    'Дата': 'date', 'Направление': 'dir', 'Подразделение': 'unit', 'Компания': 'company',
    'Регион': 'region', 'Наша должность': 'posOur', 'У них': 'posTheir', 'Грейд': 'grade',
    'Оклад от': 'payFrom', 'Оклад до': 'payTo', 'Вал. / период': 'cur',
    'Переменная часть': 'varPayMonthly', 'Совокупно, мес.': 'totalMonthly',
    'Льготы': 'benefitsCount', 'Прочие выплаты': 'extra', 'График': 'schedule', 'Источник': 'source',
    'Надёжность': 'trust', 'Комментарий': 'note', 'Кто собрал': 'by', 'Источник записи': 'recordSource'
  };
  for (const [title, key] of Object.entries(sortKeys)) {
    // «Дата» — колонка сортировки по умолчанию, у неё уже стоит стрелка (↓).
    // Заголовок сравнивается точно (с необязательной стрелкой ↑/↓ после) —
    // иначе «Источник» по префиксу задевает и «Источник записи».
    await userEvent.click(screen.getByRole('button', { name: new RegExp('^' + title + '(↑|↓)?$') }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ sort: key })));
  }
}, 15000);

// «5 500» из money() набрано с неразрывным пробелом (Intl ru-RU) — сравниваем
// текст ячейки как есть, а не через доступное имя (у него нет нормализации
// пробелов, в отличие от обычных текстовых запросов).
const totalCellText = () => {
  const head = screen.getByRole('columnheader', { name: /Совокупно/ });
  const idx = Array.from(head.parentElement!.children).indexOf(head);
  return screen.getAllByRole('cell')[idx].textContent;
};

test('совокупный доход показан колонкой', async () => {
  list.mockResolvedValue(answer({ rows: [row({ totalMonthly: 5500 })] }));
  renderScreen();
  await screen.findByRole('cell', { name: 'Алиф' });
  expect(totalCellText()).toBe((5500).toLocaleString('ru-RU'));
});

test('совокупный доход пуст, когда его не из чего посчитать', async () => {
  list.mockResolvedValue(answer({ rows: [row({ totalMonthly: null })] }));
  renderScreen();
  await screen.findByRole('cell', { name: 'Алиф' });
  expect(totalCellText()).toBe('—');
});

test('в карточке наблюдения виден совокупный доход', async () => {
  list.mockResolvedValue(answer({ rows: [row({ totalMonthly: 5500 })] }));
  renderScreen();
  await userEvent.click(await screen.findByRole('cell', { name: 'Алиф' }));
  const card = await screen.findByRole('dialog', { name: 'Алиф' });
  expect(within(card).getByText(/5 500/)).toBeInTheDocument();
});

test('в карточке наблюдения видна и премия отдельно от оклада, когда её размер известен', async () => {
  list.mockResolvedValue(answer({
    rows: [row({ bonuses: [{ type: 'KPI', size: '10%', per: 'в месяц' }], varPay: { has: true, label: 'KPI · 10%', monthly: 500 } })]
  }));
  renderScreen();
  await userEvent.click(await screen.findByRole('cell', { name: 'Алиф' }));
  const card = await screen.findByRole('dialog', { name: 'Алиф' });
  expect(within(card).getByText(/≈ 500 в месяц/)).toBeInTheDocument();
});

test('строку «≈ N в месяц» не показывает, если размер премии не распознан', async () => {
  list.mockResolvedValue(answer({
    rows: [row({ bonHas: 'да', varPay: { has: true, label: 'не указано', monthly: null } })]
  }));
  renderScreen();
  await userEvent.click(await screen.findByRole('cell', { name: 'Алиф' }));
  const card = await screen.findByRole('dialog', { name: 'Алиф' });
  expect(within(card).queryByText(/в месяц/)).not.toBeInTheDocument();
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
  await pickCombo('Компания', 'Сиёма');
  expect(await screen.findByText(/Ничего не найдено/)).toBeInTheDocument();
});

test('сброс убирает все фильтры', async () => {
  renderScreen();
  await openFilters();
  await pickCombo('Компания', 'Сиёма');
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
  for (const label of ['Направление', 'Подразделение', 'Регион', 'Компания', 'Грейд', 'График', 'Источник', 'Надёжность', 'Валюта', 'HR BP', 'Источник записи']) {
    expect(within(panel).getByLabelText(label)).toBeInTheDocument();
  }
  expect(within(panel).getByRole('button', { name: /Только с окладом/ })).toBeInTheDocument();
  expect(within(panel).getByRole('button', { name: /Только с прочими выплатами/ })).toBeInTheDocument();
});

test('выбранный фильтр виден над таблицей и снимается одним нажатием', async () => {
  renderScreen();
  await screen.findByRole('cell', { name: 'Алиф' });
  await openFilters();
  await pickCombo('Компания', 'Сиёма');
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Фильтры' })).getByRole('button', { name: /^Показать/ }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: /Компания: Сиёма/ }));
  await waitFor(() => expect(lastSearch).not.toContain('company='));
});
