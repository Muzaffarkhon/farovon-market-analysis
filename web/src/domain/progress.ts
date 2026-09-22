import type { SurveyDraft } from '../api/contract';
import { trim } from './numbers';

/** Нормализация имени для сопоставления: регистр, ё→е, схлопнутые пробелы. */
export function normName(v: unknown): string {
  return String(v == null ? '' : v).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

export function sameName(a: unknown, b: unknown): boolean {
  return normName(a) === normName(b);
}

/**
 * Прогресс одной записи — 9 пунктов (ТЗ 3.4). Число пунктов обязано совпадать
 * с числом начислений, иначе 100% недостижимы.
 */
export function recordProgress(item: Partial<SurveyDraft>): { done: number; total: 9 } {
  const checks = recordChecks(item);
  return { done: checks.filter(Boolean).length, total: 9 };
}

/** Те же 9 пунктов по порядку — булевыми значениями. Порядок совпадает с POINT_LABELS. */
function recordChecks(item: Partial<SurveyDraft>): boolean[] {
  const bonHas = trim(item.bonHas);
  const bonuses = Array.isArray(item.bonuses) ? item.bonuses : [];
  return [
    trim(item.payFrom) !== '',
    trim(item.payTo) !== '',
    bonHas !== '',
    // «параметры бонуса»: при «нет»/«не знаю» пункт закрыт самим ответом,
    // при «да» нужен хотя бы один вид с размером.
    bonHas === 'да' ? bonuses.some(b => b && trim(b.size) !== '') : bonHas !== '',
    Array.isArray(item.benefits) && item.benefits.length > 0,
    trim(item.extra) !== '',
    trim(item.source) !== '',
    trim(item.trust) !== '',
    trim(item.note) !== ''
  ];
}

/** Названия пунктов записи — для подсказки «чего не хватает» у счётчика. */
const POINT_LABELS = [
  'оклад от', 'оклад до', 'есть ли премии', 'параметры премии',
  'льготы', 'прочие выплаты', 'источник', 'надёжность', 'комментарий'
];

/** Какие из 9 пунктов ещё не заполнены. Пустой список — запись полная. */
export function missingPoints(item: Partial<SurveyDraft>): string[] {
  return recordChecks(item).flatMap((ok, i) => (ok ? [] : [POINT_LABELS[i]]));
}

/**
 * Компания считается заполненной, если есть хоть что-то существенное.
 * Совпадает с surveyHasSubstance в src/services/analyticsService.js.
 */
export function companyFilled(item: Partial<SurveyDraft>): boolean {
  if (trim(item.payFrom) !== '' && Number(item.payFrom) > 0) return true;
  if (trim(item.payTo) !== '' && Number(item.payTo) > 0) return true;
  if (Array.isArray(item.bonuses) && item.bonuses.some(b => b && trim(b.size) !== '')) return true;
  if (Array.isArray(item.benefits) && item.benefits.length > 0) return true;
  return trim(item.extra) !== '' || trim(item.note) !== '';
}

export type PositionState = {
  kind: 'untouched' | 'none' | 'partial' | 'done';
  done: number;
  total: number;
};

/**
 * Состояние должности (ТЗ 3.1): не начата / не с кем / в работе / заполнена.
 * «Не с кем» — осознанное решение, поэтому оно важнее пустого списка компаний.
 */
export function positionState(a: { selected: string[]; surveys: Partial<SurveyDraft>[]; noComparison: boolean }): PositionState {
  if (a.noComparison) return { kind: 'none', done: 0, total: 0 };
  const total = a.selected.length;
  if (total === 0) return { kind: 'untouched', done: 0, total: 0 };
  const done = a.selected.filter(c => a.surveys.some(s => sameName(s.company, c) && companyFilled(s))).length;
  return { kind: done === total ? 'done' : 'partial', done, total };
}

/** Решена ли должность: есть заполненная компания либо отметка «не с кем». */
export function isDecided(st: PositionState): boolean {
  return st.kind === 'none' || st.kind === 'done' || (st.kind === 'partial' && st.done > 0);
}

/** Прогресс подразделения — по должностям, а не по компаниям (ТЗ 3.4). */
export function unitProgress(positions: string[], stateOf: (position: string) => PositionState): { decided: number; total: number } {
  return { decided: positions.filter(p => isDecided(stateOf(p))).length, total: positions.length };
}
