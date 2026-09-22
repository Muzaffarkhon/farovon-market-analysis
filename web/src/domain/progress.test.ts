import { recordProgress, companyFilled, positionState, isDecided, unitProgress, sameName } from './progress';
import type { SurveyDraft } from '../api/contract';

const empty: SurveyDraft = {
  company: 'А', posOur: 'Б', payFrom: '', payTo: '', cur: 'сомони', payPer: 'в месяц',
  bonHas: '', bonuses: [], benefits: [], extra: '', schedule: '', source: '', trust: '', note: ''
};

test('пустая запись — 0 из 9', () => {
  expect(recordProgress(empty)).toEqual({ done: 0, total: 9 });
});

test('полная запись без премий — 9 из 9', () => {
  expect(recordProgress({
    ...empty, payFrom: '1', payTo: '2', bonHas: 'нет', benefits: ['ДМС'],
    extra: 'x', source: 'Опрос', trust: 'высокая', note: 'y', schedule: '5/2'
  })).toEqual({ done: 9, total: 9 });
});

test('полная запись с премиями — 9 из 9', () => {
  expect(recordProgress({
    ...empty, payFrom: '1', payTo: '2', bonHas: 'да', bonuses: [{ type: 'KPI', size: '10%', per: 'в месяц' }],
    benefits: ['ДМС'], extra: 'x', source: 'Опрос', trust: 'высокая', note: 'y', schedule: '5/2'
  })).toEqual({ done: 9, total: 9 });
});

test('премии «да» без размера — пункт параметров не засчитан', () => {
  const r = recordProgress({ ...empty, bonHas: 'да', bonuses: [] });
  expect(r.done).toBe(1); // засчитан только сам ответ «есть ли премии»
});

test('companyFilled: только комментарий — заполнена', () => {
  expect(companyFilled({ ...empty, note: 'x' })).toBe(true);
});

test('companyFilled: нулевой оклад не считается данными', () => {
  expect(companyFilled({ ...empty, payFrom: '0' })).toBe(false);
});

test('companyFilled: заполнен только график — данных о рынке ещё нет', () => {
  expect(companyFilled({ ...empty, schedule: '5/2' })).toBe(false);
});

test('positionState: не с кем', () => {
  expect(positionState({ selected: [], surveys: [], noComparison: true }).kind).toBe('none');
});

test('positionState: не начата', () => {
  expect(positionState({ selected: [], surveys: [], noComparison: false }).kind).toBe('untouched');
});

test('positionState: 1 из 2 — в работе', () => {
  expect(positionState({
    selected: ['А', 'Б'],
    surveys: [{ ...empty, company: 'А', payFrom: '1' }],
    noComparison: false
  })).toEqual({ kind: 'partial', done: 1, total: 2 });
});

test('positionState: 2 из 2 — заполнена', () => {
  expect(positionState({
    selected: ['А', 'Б'],
    surveys: [{ ...empty, company: 'А', payFrom: '1' }, { ...empty, company: 'Б', note: 'x' }],
    noComparison: false
  }).kind).toBe('done');
});

test('positionState: компании выбраны, данных нет — 0 из N', () => {
  expect(positionState({ selected: ['А'], surveys: [], noComparison: false }))
    .toEqual({ kind: 'partial', done: 0, total: 1 });
});

test('sameName: ё, регистр и пробелы', () => {
  expect(sameName('Слесарь-ремонтник', 'слесарь-РЕМОНТНИК ')).toBe(true);
  expect(sameName('Ёлкин', 'елкин')).toBe(true);
  expect(sameName('А  Б', 'а б')).toBe(true);
});

test('isDecided: «в работе» с нулём заполненных — ещё не решена', () => {
  expect(isDecided({ kind: 'partial', done: 0, total: 3 })).toBe(false);
  expect(isDecided({ kind: 'partial', done: 1, total: 3 })).toBe(true);
});

test('unitProgress считает по должностям', () => {
  const states: Record<string, ReturnType<typeof positionState>> = {
    'Токарь': { kind: 'done', done: 2, total: 2 },
    'Сварщик': { kind: 'partial', done: 0, total: 1 },
    'Кладовщик': { kind: 'none', done: 0, total: 0 },
    'Бухгалтер': { kind: 'untouched', done: 0, total: 0 }
  };
  expect(unitProgress(Object.keys(states), p => states[p])).toEqual({ decided: 2, total: 4 });
});
