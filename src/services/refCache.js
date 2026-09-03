'use strict';

/**
 * Кэш справочных данных: оргструктура, справочники (компании / должности /
 * сегменты / регионы), штатное расписание, права ролей, период сбора.
 *
 * getUserPayload (authController) читает их на КАЖДЫЙ вход и КАЖДЫЙ /auth/resume
 * (фронт продлевает сессию раз в ~3 ч в открытой вкладке и при возврате на
 * вкладку) — это ~10 запросов к Turso, часть полными сканами таблиц. При
 * нескольких десятках одновременно работающих пользователей это заметная
 * нагрузка на пустом месте: справочники меняются редко и только через админку.
 *
 * Поэтому короткий TTL + явный сброс при любой правке через админку. Данные
 * пользователя (его анкеты, статусы конкурентов) сюда НЕ кладём — они меняются
 * постоянно и должны отражаться сразу.
 */

const TTL_MS = 60 * 1000;
const store = new Map();   // key -> { at, value }
const inflight = new Map(); // key -> Promise (защита от «стада» на холодном кэше)

/**
 * Вернуть закэшированное значение или загрузить через loader и закэшировать.
 * Параллельные промахи по одному ключу разделяют один вызов loader.
 * @param {string} key
 * @param {() => Promise<any>} loader
 * @param {number} [ttl]
 */
async function cached(key, loader, ttl = TTL_MS) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const value = await loader();
      store.set(key, { at: Date.now(), value });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Сбросить кэш целиком (без аргументов) либо перечисленные ключи. */
function invalidate(...keys) {
  if (!keys.length) {
    store.clear();
    return;
  }
  keys.forEach(k => store.delete(k));
}

/**
 * Меняет ли этот запрос справочные данные (→ нужен сброс кэша после успеха).
 * `path` — относительный к mount-point /api (напр. «/admin/divisions»,
 * «/survey/save»). GET никогда не меняет.
 *  - /admin/*                — оргструктура, справочники, права ролей, период;
 *  - /survey/dictionary/add  — добавление значения в справочник из анкеты;
 *  - /survey/save            — divisions.survey_note + competitors.segment/region.
 * /survey/save-details не в списке — пишет только surveys.
 */
function touchesRefData(method, path) {
  if (String(method || '').toUpperCase() === 'GET') return false;
  const p = String(path || '');
  return p.startsWith('/admin/') ||
    p === '/survey/dictionary/add' ||
    p === '/survey/save';
}

// Полный сброс (кэш + in-flight) — для юнит-тестов, чтобы не мутировать
// require.cache и проверять тот же экземпляр, что использует приложение.
function _resetForTests() {
  store.clear();
  inflight.clear();
}

module.exports = { cached, invalidate, touchesRefData, TTL_MS, _resetForTests };
