'use strict';
/**
 * Единый контракт валидации записи анкеты (ТЗ раздел 11).
 *
 * Сервер — источник истины; клиент повторяет те же правила 1:1 в
 * web/src/domain/validation.ts. Обе стороны гоняют один набор кейсов из
 * test/fixtures/surveyValidation.json — расхождение ловится тестами.
 *
 * Импорт из Excel сюда НЕ ходит: у него сознательно мягкие правила
 * (плохая ячейка обнуляется, строка грузится, проблема в отчёт).
 */
const MAX_MONEY = 1e9;

function trim(v) { return String(v == null ? '' : v).trim(); }

/** '12 000,50' → 12000.5; '' → 0; мусор → null. Разделители: пробел, запятая, точка. */
function parseMoney(raw) {
  const s = trim(raw).replace(/\s+/g, '').replace(',', '.');
  if (s === '') return 0;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/**
 * Начатая запись — где заполнено хоть что-то содержательное. Ключ
 * (компания/должность), валюта и период выплаты не считаются: они есть у
 * любой строки по умолчанию.
 */
function isStarted(item) {
  const keys = ['payFrom', 'payTo', 'schedule', 'bonHas', 'source', 'trust', 'benefits', 'extra', 'note', 'posTheir'];
  if (keys.some(k => (Array.isArray(item[k]) ? item[k].length > 0 : trim(item[k]) !== ''))) return true;
  return Array.isArray(item.bonuses) && item.bonuses.some(b => b && (trim(b.type) || trim(b.size) || trim(b.per)));
}

/**
 * @param {object} item — сырая запись с клиента
 * @param {{currencies:string[], payPeriods:string[], requireForStarted?:boolean}} refs —
 *   допустимые значения справочников; requireForStarted (по умолчанию true) —
 *   требовать график/бонусы/источник/надёжность у начатой записи. Сервер
 *   выключает это для записей, которые клиент переслал без изменений: старые
 *   строки (импорт, прежние версии формы) не должны блокировать сохранение
 *   соседних, пока их никто не трогал.
 * @returns {{ok:true, value:object} | {ok:false, error:string, fields:Object<string,string>}}
 */
function validateSurveyItem(item, refs) {
  const src = item || {};
  const fields = {};
  const value = {
    company: trim(src.company), posOur: trim(src.posOur), posTheir: trim(src.posTheir), grade: trim(src.grade),
    cur: trim(src.cur || 'сомони').toLowerCase(), payPer: trim(src.payPer || 'в месяц').toLowerCase(),
    schedule: trim(src.schedule), bonHas: trim(src.bonHas), source: trim(src.source), trust: trim(src.trust),
    extra: trim(src.extra), note: trim(src.note),
    benefits: Array.isArray(src.benefits) ? src.benefits.map(trim).filter(Boolean) : src.benefits,
    bonuses: Array.isArray(src.bonuses) ? src.bonuses : [],
    payFrom: 0, payTo: 0
  };
  if (!value.company) fields.company = 'Укажите компанию';
  if (!value.posOur) fields.posOur = 'Укажите должность';

  for (const k of ['payFrom', 'payTo']) {
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
  }

  const keys = Object.keys(fields);
  if (keys.length) return { ok: false, error: fields[keys[0]], fields };
  return { ok: true, value };
}

/**
 * Подпись содержимого записи. Совпала — значит запись прислали без изменений
 * (старый клиент шлёт весь список подразделения целиком при каждом сохранении).
 * Поля перечислены явно и в фиксированном порядке: ключ (компания/должность)
 * в подпись не входит — по нему записи и сопоставляются.
 */
const SIGNATURE_FIELDS = [
  'payFrom', 'payTo', 'cur', 'payPer', 'bonuses', 'bonHas', 'bonSize', 'bonType', 'bonPer',
  'benefits', 'schedule', 'extra', 'source', 'trust', 'note', 'posTheir', 'grade'
];

function contentSignature(o) {
  const src = o || {};
  return SIGNATURE_FIELDS.map(k => String(src[k] == null ? '' : src[k])).join('');
}

/**
 * Обязательные для начатой записи поля (ТЗ 11). Возвращает объект
 * «поле → текст ошибки»; пустой объект — всё на месте.
 *
 * bonHas ожидается СЫРЫМ (до bonusesLegacy): та подставляет 'не знаю' вместо
 * пустого, и по ней незаполненное поле уже не отличить от осознанного ответа.
 */
function missingRequired(item) {
  const src = item || {};
  const fields = {};
  if (!trim(src.schedule)) fields.schedule = 'Укажите график работы';
  if (!trim(src.bonHas)) fields.bonHas = 'Укажите, есть ли премии';
  if (!trim(src.source)) fields.source = 'Укажите источник данных';
  if (!trim(src.trust)) fields.trust = 'Укажите надёжность';
  return fields;
}

module.exports = {
  validateSurveyItem, isStarted, parseMoney, MAX_MONEY,
  contentSignature, missingRequired, SIGNATURE_FIELDS
};
