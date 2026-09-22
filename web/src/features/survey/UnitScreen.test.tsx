import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { UnitScreen } from './UnitScreen';
import * as data from './useUnitData';
import type { SurveyDraft } from '../../api/contract';
import { positionState } from '../../domain/progress';

vi.mock('../shell/Shell', () => ({ useScreenTitle: () => {} }));

const empty: SurveyDraft = {
  company: '', posOur: '', payFrom: '', payTo: '', cur: 'сомони', payPer: 'в месяц',
  bonHas: '', bonuses: [], benefits: [], extra: '', schedule: '', source: '', trust: '', note: ''
};

function mockUnit() {
  const positions = ['Токарь', 'Сварщик', 'Кладовщик', 'Бухгалтер'];
  const drafts = [{ ...empty, company: 'А', posOur: 'Токарь', payFrom: '1' }];
  const selections: Record<string, string[]> = { 'Токарь': ['А', 'Б'], 'Сварщик': ['В'] };
  const noComparison = new Set(['Кладовщик']);
  vi.spyOn(data, 'useUnitData').mockReturnValue({
    isLoading: false, error: null, groupKey: '', groupUnits: [],
    positions, drafts, selections, noComparison,
    progress: { decided: 2, total: 4 },
    stateOf: (p: string) => positionState({
      selected: selections[p] ?? [],
      surveys: drafts.filter(d => d.posOur === p),
      noComparison: noComparison.has(p)
    })
  });
}

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/survey/Цех']}>
      <Routes><Route path="/survey/:unit" element={<UnitScreen />} /></Routes>
    </MemoryRouter>
  );
}

test('четыре состояния различимы, индикатор прогресса один', () => {
  mockUnit();
  renderScreen();
  expect(screen.getByText('1 из 2')).toBeInTheDocument();     // Токарь — в работе
  expect(screen.getByText('0 из 1')).toBeInTheDocument();     // Сварщик — компании есть, данных нет
  expect(screen.getByText('не с кем')).toBeInTheDocument();   // Кладовщик
  expect(screen.getByText('не начата')).toBeInTheDocument();  // Бухгалтер
  expect(screen.getByText('решено 2 из 4')).toBeInTheDocument();
  expect(document.querySelectorAll('progress')).toHaveLength(1);
});

test('фильтр-чипы и поиск появляются при более чем трёх должностях', () => {
  mockUnit();
  renderScreen();
  expect(screen.getByRole('button', { name: 'В работе' })).toBeInTheDocument();
  expect(screen.getByLabelText('Поиск')).toBeInTheDocument();
});

test('первые компании показаны на карточке', () => {
  mockUnit();
  renderScreen();
  expect(screen.getByText('А, Б')).toBeInTheDocument();
});

test('пустая штатка — понятное сообщение вместо пустого экрана', () => {
  vi.spyOn(data, 'useUnitData').mockReturnValue({
    isLoading: false, error: null, groupKey: '', groupUnits: [],
    positions: [], drafts: [], selections: {}, noComparison: new Set(),
    progress: { decided: 0, total: 0 },
    stateOf: () => ({ kind: 'untouched', done: 0, total: 0 })
  });
  renderScreen();
  expect(screen.getByText(/штатка/i)).toBeInTheDocument();
});
