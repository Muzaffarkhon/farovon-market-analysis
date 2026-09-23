import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SheetScreen } from './SheetScreen';
import * as unitData from './useUnitData';
import * as sheetActions from './useSheetActions';
import type { SessionData, SurveyDraft } from '../../api/contract';
import { positionState } from '../../domain/progress';

vi.mock('../shell/Shell', () => ({ useScreenTitle: () => {} }));

const session = {
  ref: {
    schedules: ['5/2 · 40 часов'], bonusTypes: ['KPI'], bonusPeriods: ['в месяц'],
    sources: ['Интервью'], trust: ['высокая', 'средняя', 'низкая']
  },
  benefits: [],
  companies: [{ name: 'Банк Эсхата', seg: '', region: '' }, { name: 'Алиф', seg: '', region: '' }]
} as unknown as SessionData;

vi.mock('../auth/useSession', () => ({ useSessionData: () => session }));

const actions = {
  saveCompany: vi.fn().mockResolvedValue(undefined),
  setCompanies: vi.fn().mockResolvedValue(undefined),
  addCompanyToDictionary: vi.fn().mockResolvedValue(undefined),
  setNoComparison: vi.fn().mockResolvedValue(undefined),
  clearNoComparison: vi.fn().mockResolvedValue(undefined)
};

function mockData(opts: { selected?: string[]; drafts?: SurveyDraft[]; noComparison?: boolean; groupUnits?: string[] } = {}) {
  const selected = opts.selected ?? [];
  const drafts = opts.drafts ?? [];
  const noComparison = new Set(opts.noComparison ? ['Токарь'] : []);
  vi.spyOn(unitData, 'useUnitData').mockReturnValue({
    isLoading: false, error: null, groupKey: opts.groupUnits?.length ? 'g1' : '',
    groupUnits: opts.groupUnits ?? [],
    positions: ['Токарь'], drafts,
    selections: selected.length ? { 'Токарь': selected } : {},
    noComparison,
    progress: { decided: 0, total: 1 },
    stateOf: () => positionState({ selected, surveys: drafts, noComparison: noComparison.has('Токарь') })
  });
  vi.spyOn(sheetActions, 'useSheetActions').mockReturnValue(actions);
}

function renderSheet() {
  return render(
    <MemoryRouter initialEntries={['/survey/Цех/Токарь']}>
      <Routes><Route path="/survey/:unit/:position" element={<SheetScreen />} /></Routes>
    </MemoryRouter>
  );
}

/** Открыть блок заголовком: в карточке раскрыт ровно один блок. */
const openBlock = (title: RegExp) => userEvent.click(screen.getByRole('button', { name: title }));

beforeEach(() => vi.clearAllMocks());

test('без компаний предлагает добавить или отметить «не с кем»', () => {
  mockData();
  renderSheet();
  expect(screen.getByRole('button', { name: 'Добавить компанию' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Сравнивать не с кем' })).toBeInTheDocument();
});

test('«Добавить компанию» открывает шторку выбора', async () => {
  mockData();
  renderSheet();
  await userEvent.click(screen.getByRole('button', { name: 'Добавить компанию' }));
  expect(await screen.findByRole('dialog', { name: 'Компании для сравнения' })).toBeInTheDocument();
  expect(screen.getByLabelText('Банк Эсхата')).toBeInTheDocument();
});

test('отметка компании сразу сохраняет выбор', async () => {
  mockData();
  renderSheet();
  await userEvent.click(screen.getByRole('button', { name: 'Добавить компанию' }));
  await userEvent.click(await screen.findByLabelText('Алиф'));
  expect(actions.setCompanies).toHaveBeenCalledWith('Токарь', ['Алиф']);
});

test('компания не из справочника добавляется на лету', async () => {
  mockData();
  renderSheet();
  await userEvent.click(screen.getByRole('button', { name: 'Добавить компанию' }));
  await userEvent.type(await screen.findByLabelText('Поиск'), 'Зет Групп');
  await userEvent.click(screen.getByRole('button', { name: /Добавить «Зет Групп»/ }));
  expect(actions.addCompanyToDictionary).toHaveBeenCalledWith('Зет Групп');
});

test('в анкете нет выбора валюты', () => {
  mockData({ selected: ['Алиф'] });
  renderSheet();
  expect(screen.queryByLabelText('Валюта')).not.toBeInTheDocument();
});

test('заполненная карточка сохраняется с сомони по умолчанию', async () => {
  mockData({ selected: ['Алиф'] });
  renderSheet();
  await userEvent.type(screen.getByLabelText('Оклад от'), '5000');
  // Открыт всегда один блок — переходим по заголовкам.
  await openBlock(/^График работы/);
  await userEvent.selectOptions(screen.getByLabelText('График работы'), '5/2 · 40 часов');
  await openBlock(/^Премии и бонусы/);
  await userEvent.selectOptions(screen.getByLabelText('Есть ли премии'), 'нет');
  await openBlock(/^Откуда данные/);
  await userEvent.selectOptions(screen.getByLabelText('Источник'), 'Интервью');
  await userEvent.selectOptions(screen.getByLabelText('Надёжность'), 'высокая');
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

  expect(actions.saveCompany).toHaveBeenCalled();
  const [draft, spread] = actions.saveCompany.mock.calls[0];
  expect(draft.company).toBe('Алиф');
  expect(draft.cur).toBe('сомони');
  expect(draft.payFrom).toBe('5000');
  expect(spread).toBe(true);
});

test('смежная группа: перед сохранением спрашивают, куда разносить', async () => {
  mockData({ selected: ['Алиф'], groupUnits: ['Цех', 'Анхор', 'ТМК'] });
  renderSheet();
  await userEvent.type(screen.getByLabelText('Оклад от'), '100');
  // Открыт всегда один блок — переходим по заголовкам.
  await openBlock(/^График работы/);
  await userEvent.selectOptions(screen.getByLabelText('График работы'), '5/2 · 40 часов');
  await openBlock(/^Премии и бонусы/);
  await userEvent.selectOptions(screen.getByLabelText('Есть ли премии'), 'нет');
  await openBlock(/^Откуда данные/);
  await userEvent.selectOptions(screen.getByLabelText('Источник'), 'Интервью');
  await userEvent.selectOptions(screen.getByLabelText('Надёжность'), 'высокая');
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

  expect(actions.saveCompany).not.toHaveBeenCalled();
  expect(await screen.findByRole('dialog', { name: /несколько площадок/i })).toBeInTheDocument();
  expect(screen.getByText('Анхор')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Только сюда' }));
  expect(actions.saveCompany).toHaveBeenCalledWith(expect.anything(), false);
});

test('отметка «не с кем» и её снятие', async () => {
  mockData();
  const { unmount } = renderSheet();
  await userEvent.click(screen.getByRole('button', { name: 'Сравнивать не с кем' }));
  expect(actions.setNoComparison).toHaveBeenCalledWith('Токарь');
  unmount();

  mockData({ noComparison: true });
  renderSheet();
  expect(screen.getByText('не с кем')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Передумал' }));
  expect(actions.clearNoComparison).toHaveBeenCalledWith('Токарь');
});

const fullDraft = (company: string): SurveyDraft => ({
  company, posOur: 'Токарь', payFrom: '100', payTo: '200', cur: 'сомони', payPer: 'в месяц',
  bonHas: 'нет', bonuses: [], benefits: ['ДМС'], extra: '', schedule: '5/2 · 40 часов',
  source: 'Интервью', trust: 'высокая', note: 'ок'
});

const isActive = (name: string) => screen.getByRole('button', { name: new RegExp('^' + name) }).className.includes('selected');

test('полностью заполненная компания после сохранения переключает на следующую незаполненную', async () => {
  mockData({ selected: ['Алиф', 'Банк Эсхата'], drafts: [fullDraft('Алиф')] });
  renderSheet();
  expect(isActive('Алиф')).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(actions.saveCompany).toHaveBeenCalled();
  expect(isActive('Банк Эсхата')).toBe(true);
});

test('неполная компания после сохранения остаётся открытой', async () => {
  mockData({ selected: ['Алиф', 'Банк Эсхата'], drafts: [{ ...fullDraft('Алиф'), note: '' }] });
  renderSheet();
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(actions.saveCompany).toHaveBeenCalled();
  expect(isActive('Алиф')).toBe(true);
});

test('после закрытия шторки выбора открыта первая компания', async () => {
  mockData({ selected: ['Алиф', 'Банк Эсхата'] });
  renderSheet();
  await userEvent.click(screen.getByRole('button', { name: /^Банк Эсхата/ }));
  expect(isActive('Банк Эсхата')).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Добавить компанию' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Закрыть' }));
  expect(isActive('Алиф')).toBe(true);
});

test('над формой названы незаполненные пункты', () => {
  mockData({ selected: ['Алиф'], drafts: [{ ...fullDraft('Алиф'), schedule: '' }] });
  renderSheet();
  expect(screen.getByText('Не заполнено: график')).toBeInTheDocument();
});
