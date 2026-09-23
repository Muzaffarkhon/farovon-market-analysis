'use strict';

/**
 * Реестр собранных данных — каждое наблюдение одной строкой.
 *
 * Отдельно от analyticsService намеренно: аналитике нужны медианы, вилки и
 * рейтинги, реестру — только сырые строки, фильтры и страница. Гонять полный
 * расчёт ради 50 строк дорого, и любая правка аналитики ломала бы реестр.
 * Разбор переменной части переиспользуется из аналитики — вторая реализация
 * разошлась бы с дашбордом на тех же данных.
 *
 * Ядро (buildRegistry) чистое: принимает уже прочитанные строки и фильтры.
 * Это же и делает его проверяемым без базы.
 */

const { queryAll } = require('../db/database');
const {
  parseBonusesCol, summarizeVarPay, isPieceRate, looksHourly, toMonthly,
  resolveDashboardPeriodId
} = require('./analyticsService');
const { isHiddenCompany } = require('./companyFilter');

const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 200;

/** По каким колонкам разрешено сортировать. Всё прочее — по дате, новые сверху. */
const SORTABLE = [
  'date', 'company', 'unit', 'dir', 'posOur', 'posTheir', 'grade', 'region',
  'payFrom', 'payTo', 'cur', 'varPayMonthly', 'benefitsCount', 'totalMonthly',
  'schedule', 'source', 'trust', 'by', 'extra', 'note', 'recordSource'
];

/** Числовые колонки — сравниваются как числа, а не строкой («9» после «10»). */
const NUMERIC_SORT = new Set(['payFrom', 'payTo', 'varPayMonthly', 'benefitsCount', 'totalMonthly']);
/** Эти два не лежат в строке готовым полем — их считает numericValue ниже.
 *  Пусто (нет данных) уходит в конец списка независимо от направления
 *  сортировки — так «сортировка по возрастанию» не начинается с прочерков. */
const NULLABLE_NUMERIC = new Set(['varPayMonthly', 'totalMonthly']);

function numericValue(row, key) {
  if (key === 'varPayMonthly') return (row.varPay && row.varPay.monthly != null) ? row.varPay.monthly : null;
  if (key === 'benefitsCount') return Array.isArray(row.benefits) ? row.benefits.length : 0;
  return row[key];
}

/** Поля-грани: из них собираются выпадающие списки фильтров. */
const FACETS = {
  dirs: 'dir', hrbps: 'hrbp', regions: 'region', units: 'unit', companies: 'company',
  sources: 'source', trusts: 'trust', schedules: 'schedule', currencies: 'cur', grades: 'grade',
  recordSources: 'recordSource'
};

/** Фильтры «поле равно значению». Ключ фильтра → поле строки. */
const EXACT = {
  dir: 'dir', hrbp: 'hrbp', region: 'region', unit: 'unit', company: 'company',
  posOur: 'posOur', source: 'source', trust: 'trust', schedule: 'schedule',
  cur: 'cur', grade: 'grade', bonHas: 'bonHas', recordSource: 'recordSource'
};

/** «Анкета» / «Импорт из Excel» — сид анкеты, заведённой импортом, всегда
 * начинается с imp_ (см. surveyImport.js), у обычной записи — с s_ (newRowId
 * в surveyController.js). Отдельного столбца в схеме заводить не пришлось —
 * признак уже целиком в существующем ключе. */
const RECORD_SOURCE_LABEL = { manual: 'Анкета', import: 'Импорт из Excel' };
function recordSourceOf(sid) {
  return String(sid || '').startsWith('imp_') ? 'import' : 'manual';
}

const trim = (v) => String(v == null ? '' : v).trim();
const low = (v) => trim(v).toLowerCase();

/** Должность не сопоставлена со справочником — такие строки не попадают в аналитику. */
function isUnmapped(row) {
  const p = trim(row.posOur);
  return !p || p === '(не сопоставлено)';
}

/**
 * Строка реестра из строки surveys. Здесь же — всё, что знает о подразделении
 * (направление, регион, HR BP): в самой анкете этого нет, а в фильтрах нужно.
 */
function toRow(s, unitInfo) {
  const u = unitInfo || { dir: '', hrbp: '', region: '' };
  const note = trim(s.note);
  const payFrom = Number(s.pay_from) || 0;
  const payTo = Number(s.pay_to) || 0;
  const payPer = trim(s.pay_per) || 'в месяц';

  // Для свёртки переменной части нужен месячный оклад: ЧТС умножается на часы,
  // сдельные ставки в месяц не переводятся (см. analyticsService).
  const piece = isPieceRate(payPer);
  const hourly = !piece && looksHourly(payPer, payFrom, payTo);
  const fromM = piece ? 0 : toMonthly(payFrom, hourly);
  const toM = piece ? 0 : toMonthly(payTo, hourly);
  const mid = (fromM > 0 && toM > 0) ? (fromM + toM) / 2 : (fromM || toM || 0);

  const bonHas = low(s.bon_has);
  const bonuses = parseBonusesCol(s.bonuses, s.bon_type, s.bon_size, s.bon_per);
  const varPay = summarizeVarPay(bonuses, bonHas, mid);

  // Совокупно в месяц: оклад + премия, приведённая к месяцу (см. totalPayCell
  // в старом клиенте). Явное «нет премии» — известный ноль, а не «неизвестно»
  // (summarizeVarPay сам null не даёт для этого случая — там ему нечего
  // складывать). Прочерк остаётся только когда нет оклада или размер премии
  // указан, но не распознан («оклад + неизвестно» хуже пустой ячейки).
  const bonusMonthly = bonHas === 'нет' ? 0 : varPay.monthly;
  const totalMonthly = (mid > 0 && bonusMonthly != null) ? Math.round(mid + bonusMonthly) : null;

  // Регион: сначала структурный (divisions.region), иначе — из примечания
  // импортированных строк («Собрал: …; Регион: Худжанд; ID_Бизнес: 11»).
  const regionFromNote = note.match(/Регион:\s*([^;·]+)/i);

  return {
    id: s.sid || String(s.id || ''),
    date: s.created_at || '',
    by: trim(s.created_by),
    dir: trim(u.dir),
    hrbp: trim(u.hrbp),
    unit: trim(s.unit),
    region: trim(u.region) || (regionFromNote ? trim(regionFromNote[1]) : ''),
    company: trim(s.company),
    posOur: trim(s.pos_our),
    posTheir: trim(s.pos_their),
    grade: trim(s.grade),
    payFrom, payTo,
    cur: trim(s.cur) || 'сомони',
    payPer,
    bonHas,
    bonuses,
    varPay,
    totalMonthly,
    benefits: s.benefits ? String(s.benefits).split(';').map(trim).filter(Boolean) : [],
    extra: trim(s.extra),
    schedule: trim(s.schedule),
    source: trim(s.source),
    trust: trim(s.trust),
    note,
    recordSource: recordSourceOf(s.sid)
  };
}

/** Поиск идёт по тому, что человек реально помнит: компания, должности, кто собрал,
 * и по комментарию — свободный текст, единственное место, где его можно найти. */
function matchesSearch(row, q) {
  if (!q) return true;
  return [row.company, row.posOur, row.posTheir, row.by, row.unit, row.dir, row.region, row.note]
    .some(v => low(v).includes(q));
}

function applyFilters(rows, f) {
  const q = low(f.search);
  return rows.filter(row => {
    for (const key of Object.keys(EXACT)) {
      const want = trim(f[key]);
      if (want && trim(row[EXACT[key]]) !== want) return false;
    }
    if (f.onlyUnmapped && !isUnmapped(row)) return false;
    if (f.withPayOnly && !(row.payFrom > 0 || row.payTo > 0)) return false;
    if (f.withExtraOnly && !row.extra) return false;
    return matchesSearch(row, q);
  });
}

/**
 * Грани считаются по видимым пользователю строкам ДО применения фильтров:
 * иначе выбранное значение исчезало бы из собственного списка и снять фильтр
 * было бы нечем.
 */
function buildFacets(rows) {
  const out = {};
  for (const [name, field] of Object.entries(FACETS)) {
    const seen = new Set();
    rows.forEach(r => { const v = trim(r[field]); if (v) seen.add(v); });
    out[name] = Array.from(seen).sort((a, b) => a.localeCompare(b, 'ru'));
  }
  return out;
}

function sortRows(rows, sort, order) {
  const key = SORTABLE.includes(sort) ? sort : 'date';
  const sign = low(order) === 'asc' ? 1 : -1;
  if (NUMERIC_SORT.has(key)) {
    return rows.slice().sort((a, b) => {
      const x = numericValue(a, key);
      const y = numericValue(b, key);
      if (NULLABLE_NUMERIC.has(key)) {
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
      }
      return ((Number(x) || 0) - (Number(y) || 0)) * sign;
    });
  }
  return rows.slice().sort((a, b) => {
    const cmp = String(a[key] || '').localeCompare(String(b[key] || ''), 'ru');
    return cmp * sign;
  });
}

function pageOf(rows, page, perPage) {
  const size = Math.min(MAX_PER_PAGE, Math.max(1, parseInt(perPage, 10) || DEFAULT_PER_PAGE));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(pages, Math.max(1, parseInt(page, 10) || 1));
  return { rows: rows.slice((p - 1) * size, p * size), page: p, perPage: size, pages };
}

/**
 * Строки, которые вообще доступны этому пользователю, — до фильтров.
 * Здесь же отсекаются компании, исключённые из обзора рынка (ООО / ҶДММ,
 * см. services/companyFilter) — как и во всех остальных разделах.
 */
function visibleRows(data, opts = {}) {
  const surveys = Array.isArray(data.surveys) ? data.surveys : [];
  const divisions = Array.isArray(data.divisions) ? data.divisions : [];
  const unitFilter = typeof opts.unitFilter === 'function' ? opts.unitFilter : null;

  const unitMap = {};
  const allowed = unitFilter ? new Set() : null;
  divisions.forEach(d => {
    unitMap[d.unit] = { dir: d.dir || '', hrbp: d.hrbp || '', region: d.region || '' };
    if (allowed && unitFilter(d)) allowed.add(d.unit);
  });

  const out = [];
  surveys.forEach(s => {
    const unit = trim(s.unit);
    if (allowed && !allowed.has(unit)) return;
    if (isHiddenCompany(s.company)) return;
    out.push(toRow(s, unitMap[unit]));
  });
  return out;
}

/**
 * Чистое ядро реестра.
 *
 * @param {{surveys: object[], divisions: object[]}} data сырые строки из базы
 * @param {object} filters фильтры запроса
 * @param {{unitFilter?: function|null}} opts ограничение видимости по роли
 */
function buildRegistry(data, filters = {}, opts = {}) {
  const visible = visibleRows(data, opts);
  const facets = buildFacets(visible);
  const filtered = applyFilters(visible, filters);
  const sorted = sortRows(filtered, filters.sort, filters.order);
  const paged = pageOf(sorted, filters.page, filters.perPage);

  return {
    rows: paged.rows,
    total: filtered.length,
    totalAll: visible.length,
    page: paged.page,
    pages: paged.pages,
    perPage: paged.perPage,
    unmapped: visible.filter(isUnmapped).length,
    facets,
    scoped: typeof opts.unitFilter === 'function'
  };
}

/** Все отфильтрованные строки без страницы — для выгрузки. */
function buildRegistryAll(data, filters = {}, opts = {}) {
  const visible = visibleRows(data, opts);
  return {
    rows: sortRows(applyFilters(visible, filters), filters.sort, filters.order),
    facets: buildFacets(visible)
  };
}

const CSV_COLUMNS = [
  ['date', 'Дата'], ['dir', 'Направление'], ['unit', 'Подразделение'], ['region', 'Регион'],
  ['company', 'Компания'], ['posOur', 'Наша должность'], ['posTheir', 'Должность у них'],
  ['grade', 'Грейд'], ['payFrom', 'Оклад от'], ['payTo', 'Оклад до'], ['cur', 'Валюта'],
  ['payPer', 'Период выплаты'], ['varPay', 'Переменная часть'], ['totalMonthly', 'Совокупно, мес.'], ['benefits', 'Льготы'],
  ['extra', 'Прочие выплаты'], ['schedule', 'График'], ['source', 'Источник'],
  ['trust', 'Надёжность'], ['by', 'Кто собрал'], ['note', 'Примечание'],
  ['recordSourceLabel', 'Источник записи']
];

/** Значение ячейки как текст — списки и свёртки разворачиваем читаемо. */
function cellText(row, key) {
  if (key === 'benefits') return (row.benefits || []).join(', ');
  if (key === 'varPay') return (row.varPay && row.varPay.label) || '';
  if (key === 'recordSourceLabel') return RECORD_SOURCE_LABEL[row.recordSource] || '';
  const v = row[key];
  return v == null ? '' : String(v);
}

/**
 * CSV для Excel: разделитель «;» (русская локаль), кавычки удваиваются,
 * перевод строки внутри ячейки сохраняется. BOM добавляет контроллер.
 */
function toCsv(rows) {
  const esc = (v) => {
    const s = String(v == null ? '' : v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = CSV_COLUMNS.map(c => esc(c[1])).join(';');
  const body = rows.map(r => CSV_COLUMNS.map(c => esc(cellText(r, c[0]))).join(';'));
  return [head].concat(body).join('\r\n');
}

/** Чтение из базы + сборка. Период — как на дашборде: явный или активный. */
async function loadRegistryData(filters = {}) {
  const periods = await queryAll(
    'SELECT id, name, is_active AS "isActive" FROM periods ORDER BY id DESC'
  ).catch(() => []);
  const currentId = (periods.find(p => p.isActive) || periods[0] || {}).id ?? null;
  const periodId = resolveDashboardPeriodId(filters.period, currentId);

  const [divisions, surveys] = await Promise.all([
    queryAll("SELECT num, dir, unit, head, resp, hrbp, COALESCE(region,'') AS region FROM divisions")
      .catch(() => queryAll('SELECT num, dir, unit, head, resp, hrbp FROM divisions')
        .then(rows => rows.map(r => ({ ...r, region: '' })))),
    periodId
      ? queryAll("SELECT * FROM surveys WHERE state != 'удалена' AND period_id = ?", [periodId])
      : queryAll("SELECT * FROM surveys WHERE state != 'удалена'")
  ]);

  const period = periods.find(p => p.id === periodId) || null;
  return { data: { surveys, divisions }, periods, period: period ? { id: period.id, name: period.name } : null };
}

async function getRegistry(filters = {}, opts = {}) {
  const { data, periods, period } = await loadRegistryData(filters);
  return { ...buildRegistry(data, filters, opts), period, periods };
}

async function getRegistryCsv(filters = {}, opts = {}) {
  const { data } = await loadRegistryData(filters);
  const { rows } = buildRegistryAll(data, filters, opts);
  return { csv: toCsv(rows), count: rows.length };
}

module.exports = {
  buildRegistry, buildRegistryAll, getRegistry, getRegistryCsv,
  toCsv, toRow, isUnmapped, SORTABLE, DEFAULT_PER_PAGE, MAX_PER_PAGE, CSV_COLUMNS
};
