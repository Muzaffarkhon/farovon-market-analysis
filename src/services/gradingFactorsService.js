'use strict';

/**
 * Тексты анкет оценки: чтение из таблицы grading_factors и правка из админки.
 *
 * Формулировки лежат в базе, чтобы C&B менял вопросы и расшифровку баллов сам,
 * без разработчика. Значения из src/config/gradingFactors.js — исходная
 * Google-форма — остаются запасным вариантом: если таблицы ещё нет (сервер
 * поднялся раньше миграции) или строка почему-то пропала, анкета показывается
 * по коду, а не ломается.
 *
 * Кэш на минуту — тот же приём, что в roleService: тексты меняют раз в
 * полгода, а запрашиваются при каждом открытии раздела.
 */

const { queryAll, queryOne, run } = require('../db/database');
const { GROUP_FACTORS, RISK_FACTORS } = require('../config/gradingFactors');
const { GROUP_KEYS, GradingError } = require('./gradingService');

const TTL_MS = 60 * 1000;
const RISK_SCOPE = 'risk';
const SCOPES = [...GROUP_KEYS, RISK_SCOPE];
const OPTION_COUNT = 5;
const MAX_TITLE = 300;
const MAX_TEXT = 1000;

let cache = null;
let cachedAt = 0;

/** Сколько факторов у каждой анкеты — по этому проверяем правку. */
function expectedCount(scope) {
  return scope === RISK_SCOPE ? RISK_FACTORS.length : (GROUP_FACTORS[scope] || []).length;
}

function fromRow(row) {
  const factor = {
    code: row.code,
    title: row.title,
    help: row.help || '',
    options: [row.option_1, row.option_2, row.option_3, row.option_4, row.option_5],
    // '' — общая формулировка; иначе видно, что текст переопределён под
    // конкретное направление (в админке это помечается плашкой).
    dir: String(row.dir || ''),
    updatedBy: row.updated_by || '',
    updatedAt: row.updated_at || ''
  };
  // Поле анкеты рисков (bus_factor и т.д.) остаётся привязкой к колонке базы и
  // берётся из кода — админ правит только текст вопроса, не смысл колонки.
  if (row.scope === RISK_SCOPE) {
    const known = RISK_FACTORS[row.idx - 1];
    if (known) factor.field = known.field;
  }
  return factor;
}

/**
 * Отбор строк под нужное направление: { scope: [фактор по порядку] }.
 * Чужие направления отбрасываем, своё перекрывает общее (dir = '').
 * Вынесено отдельно от запроса к базе, чтобы правило перекрытия можно было
 * прогнать тестом.
 */
function pickForDir(rows, wantDir) {
  const byScope = {};
  rows.forEach(r => {
    const rowDir = String(r.dir || '');
    if (rowDir && rowDir !== wantDir) return;
    if (!byScope[r.scope]) byScope[r.scope] = [];
    const slot = r.idx - 1;
    if (!byScope[r.scope][slot] || rowDir) byScope[r.scope][slot] = fromRow(r);
  });
  return byScope;
}

/** Запасной вариант — исходные формулировки из кода. */
function fallback() {
  const groups = {};
  GROUP_KEYS.forEach(key => { groups[key] = (GROUP_FACTORS[key] || []).map(f => ({ ...f })); });
  return { groups, risk: RISK_FACTORS.map(f => ({ ...f })), source: 'код' };
}

/** Все строки таблицы с коротким кэшем — направлений мало, фильтруем в памяти. */
async function loadRows() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const rows = await queryAll('SELECT * FROM grading_factors ORDER BY scope ASC, idx ASC, dir ASC');
  cache = rows;
  cachedAt = Date.now();
  return rows;
}

/**
 * Формулировки анкет для конкретного направления:
 * { groups: {production: [...]}, risk: [...] }.
 *
 * Порядок подстановки: своя формулировка направления → общая (dir = '') →
 * исходная из кода. Так «Департамент производства муки» может описывать
 * баллы про мельницу, а все остальные видят общий текст, и веса при этом
 * у всех одни — уровни остаются сравнимыми между заводами.
 */
async function getFactors(dir) {
  const wantDir = String(dir == null ? '' : dir).trim();

  let rows = [];
  try {
    rows = await loadRows();
  } catch (err) {
    console.error('gradingFactorsService.getFactors error:', err.message);
    return fallback();
  }
  if (!rows.length) return fallback();

  const result = fallback();
  result.source = 'база';
  result.dir = wantDir;
  const byScope = pickForDir(rows, wantDir);

  // Подменяем только те анкеты, которые в базе заполнены целиком: половина
  // вопросов из базы и половина из кода — это путаница на экране оценки.
  GROUP_KEYS.forEach(key => {
    const list = byScope[key];
    if (list && list.filter(Boolean).length === expectedCount(key)) result.groups[key] = list;
  });
  const riskList = byScope[RISK_SCOPE];
  if (riskList && riskList.filter(Boolean).length === expectedCount(RISK_SCOPE)) result.risk = riskList;

  return result;
}

function cleanText(raw, max) {
  return String(raw == null ? '' : raw).trim().slice(0, max);
}

/**
 * Правка одного вопроса анкеты. Меняются только тексты: код фактора («П1»),
 * его порядок и вес остаются за кодом — от них зависит расчёт балла.
 */
async function saveFactor(input) {
  const scope = cleanText(input && input.scope, 30);
  const idx = parseInt(input && input.idx, 10);

  if (!SCOPES.includes(scope)) throw new GradingError('Неизвестная анкета: ' + (scope || '(пусто)'));
  if (!Number.isInteger(idx) || idx < 1 || idx > expectedCount(scope)) {
    throw new GradingError('Неверный номер вопроса анкеты');
  }

  const title = cleanText(input.title, MAX_TITLE);
  if (!title) throw new GradingError('Формулировка вопроса не может быть пустой');

  const help = cleanText(input.help, MAX_TEXT);
  const options = Array.isArray(input.options) ? input.options.map(o => cleanText(o, MAX_TEXT)) : [];
  if (options.length !== OPTION_COUNT || options.some(o => !o)) {
    throw new GradingError(`Нужно заполнить все ${OPTION_COUNT} вариантов ответа (баллы 1–5)`);
  }

  const dir = await checkDir(input.dir);
  const author = cleanText(input.updatedBy, MAX_TITLE) || 'не указан';

  // Код фактора («П1») берём у общей строки — он часть расчёта и одинаков
  // для всех направлений.
  const base = await queryOne(
    "SELECT code FROM grading_factors WHERE scope = ? AND idx = ? AND dir = '' ",
    [scope, idx]
  );
  if (!base) throw new GradingError('Вопрос анкеты не найден — сначала выполните миграцию базы');

  await run(
    `INSERT INTO grading_factors
       (scope, idx, dir, code, title, help, option_1, option_2, option_3, option_4, option_5, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope, idx, dir) DO UPDATE SET
       title = excluded.title,
       help = excluded.help,
       option_1 = excluded.option_1,
       option_2 = excluded.option_2,
       option_3 = excluded.option_3,
       option_4 = excluded.option_4,
       option_5 = excluded.option_5,
       updated_by = excluded.updated_by,
       updated_at = CURRENT_TIMESTAMP`,
    [scope, idx, dir, base.code, title, help, ...options, author]
  );

  invalidate();
  return { scope, idx, dir, title };
}

/**
 * Сброс вопроса: у направления — удаление его формулировки (дальше действует
 * общая), у общей — возврат к исходному тексту Google-формы.
 */
async function resetFactor(scope, idx, dirRaw, updatedBy) {
  if (!SCOPES.includes(scope)) throw new GradingError('Неизвестная анкета: ' + (scope || '(пусто)'));
  if (!Number.isInteger(idx) || idx < 1 || idx > expectedCount(scope)) {
    throw new GradingError('Неверный номер вопроса анкеты');
  }
  const dir = await checkDir(dirRaw);

  if (dir) {
    await run('DELETE FROM grading_factors WHERE scope = ? AND idx = ? AND dir = ?', [scope, idx, dir]);
    invalidate();
    return { scope, idx, dir, title: '' };
  }

  const list = scope === RISK_SCOPE ? RISK_FACTORS : GROUP_FACTORS[scope];
  const source = list && list[idx - 1];
  if (!source) throw new GradingError('Исходной формулировки для этого вопроса нет');
  return saveFactor({
    scope, idx, dir: '', title: source.title, help: source.help, options: source.options, updatedBy
  });
}

/** Направление должно существовать в оргструктуре; '' — общая формулировка. */
async function checkDir(raw) {
  const dir = cleanText(raw, MAX_TITLE);
  if (!dir) return '';
  const row = await queryOne('SELECT 1 AS ok FROM divisions WHERE TRIM(dir) = ? LIMIT 1', [dir]);
  if (!row) throw new GradingError('Такого направления нет в оргструктуре: ' + dir);
  return dir;
}

function invalidate() {
  cache = null;
  cachedAt = 0;
}

/** Направления, у которых уже есть собственные формулировки. */
async function listOverrideDirs() {
  try {
    const rows = await loadRows();
    return [...new Set(rows.map(r => String(r.dir || '')).filter(Boolean))].sort();
  } catch (err) {
    console.error('gradingFactorsService.listOverrideDirs error:', err.message);
    return [];
  }
}

module.exports = {
  getFactors, saveFactor, resetFactor, listOverrideDirs, invalidate, pickForDir, SCOPES, RISK_SCOPE
};
