import type { Bonus, SurveyDraft } from '../api/contract';
import { MAX_MONEY, parseMoney, trim } from './numbers';

export type ValidationRefs = { currencies: readonly string[]; payPeriods: readonly string[]; requireForStarted?: boolean };
export type CleanSurvey = {
  company: string; posOur: string; posTheir: string; grade: string;
  cur: string; payPer: string; payFrom: number; payTo: number;
  schedule: string; bonHas: string; source: string; trust: string;
  extra: string; note: string; benefits: string[]; bonuses: Bonus[];
};
export type ValidationResult =
  | { ok: true; value: CleanSurvey }
  | { ok: false; error: string; fields: Record<string, string> };

export const BONUSES_INCOMPLETE = 'У каждого вида премии укажите вид, размер и периодичность';

/**
 * Премии заполнены полностью (ТЗ 3.2): при «да» должен быть хотя бы один вид,
 * и у каждого заполнены вид, размер и периодичность.
 */
export function bonusesComplete(bonHas: unknown, bonuses: unknown): boolean {
  if (trim(bonHas).toLowerCase() !== 'да') return true;
  const all = Array.isArray(bonuses) ? (bonuses as Bonus[]) : [];
  // Совсем пустая строка — случайное нажатие «Добавить вид», её отбрасываем
  // (сервер при сохранении делает то же). Начатая наполовину — ошибка.
  const started = all.filter(b => b && (trim(b.type) || trim(b.size) || trim(b.per)));
  if (!started.length) return false;
  return started.every(b => trim(b.type) && trim(b.size) && trim(b.per));
}

/** Какие поля вида премии пусты — чтобы подсветить именно их. Пустую строку не трогаем. */
export function bonusRowGaps(b: Bonus): { type: boolean; size: boolean; per: boolean } {
  const untouched = !trim(b?.type) && !trim(b?.size) && !trim(b?.per);
  if (untouched) return { type: false, size: false, per: false };
  return { type: !trim(b?.type), size: !trim(b?.size), per: !trim(b?.per) };
}

/**
 * Начатая запись — где заполнено хоть что-то содержательное. Ключ
 * (компания/должность), валюта и период выплаты не в счёт: они есть всегда.
 */
export function isStarted(item: Partial<SurveyDraft>): boolean {
  const keys: (keyof SurveyDraft)[] = ['payFrom', 'payTo', 'schedule', 'bonHas', 'source', 'trust', 'benefits', 'extra', 'note', 'posTheir'];
  if (keys.some(k => {
    const v = item[k];
    return Array.isArray(v) ? v.length > 0 : trim(v) !== '';
  })) return true;
  return Array.isArray(item.bonuses) && item.bonuses.some(b => b && (trim(b.type) || trim(b.size) || trim(b.per)));
}

/**
 * Единый контракт валидации (ТЗ 11). Повторяет src/services/surveyValidation.js
 * один в один; обе стороны гоняют test/fixtures/surveyValidation.json.
 * Сервер остаётся источником истины — здесь только скорость отклика.
 */
export function validateSurveyItem(item: Partial<SurveyDraft>, refs: ValidationRefs): ValidationResult {
  const src = item || {};
  const fields: Record<string, string> = {};
  const value: CleanSurvey = {
    company: trim(src.company), posOur: trim(src.posOur), posTheir: trim(src.posTheir), grade: trim(src.grade),
    cur: trim(src.cur || 'сомони').toLowerCase(), payPer: trim(src.payPer || 'в месяц').toLowerCase(),
    schedule: trim(src.schedule), bonHas: trim(src.bonHas), source: trim(src.source), trust: trim(src.trust),
    extra: trim(src.extra), note: trim(src.note),
    benefits: Array.isArray(src.benefits) ? src.benefits.map(trim).filter(Boolean) : [],
    bonuses: Array.isArray(src.bonuses) ? src.bonuses : [],
    payFrom: 0, payTo: 0
  };
  if (!value.company) fields.company = 'Укажите компанию';
  if (!value.posOur) fields.posOur = 'Укажите должность';

  for (const k of ['payFrom', 'payTo'] as const) {
    const n = parseMoney(src[k]);
    if (n === null) fields[k] = 'Только число';
    else if (n < 0) fields[k] = 'Не может быть отрицательным';
    else if (n > MAX_MONEY) fields[k] = 'Слишком большое число';
    else value[k] = n;
  }
  if (!fields.payFrom && !fields.payTo && value.payFrom > 0 && value.payTo > 0 && value.payFrom > value.payTo) {
    fields.payTo = '«До» не может быть меньше «от»';
  }
  if (!refs.currencies.includes(value.cur)) fields.cur = 'Валюта не из справочника';
  if (!refs.payPeriods.includes(value.payPer)) fields.payPer = 'Период выплаты не из справочника';

  if (refs.requireForStarted !== false && isStarted(src)) {
    if (!value.schedule) fields.schedule = 'Укажите график работы';
    if (!value.bonHas) fields.bonHas = 'Укажите, есть ли премии';
    if (!value.source) fields.source = 'Укажите источник данных';
    if (!value.trust) fields.trust = 'Укажите надёжность';
    if (!bonusesComplete(value.bonHas, value.bonuses)) fields.bonuses = BONUSES_INCOMPLETE;
  }

  const keys = Object.keys(fields);
  if (keys.length) return { ok: false, error: fields[keys[0]], fields };
  return { ok: true, value };
}
