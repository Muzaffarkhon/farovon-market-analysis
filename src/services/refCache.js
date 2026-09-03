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
const store = new Map(); // key -> { at, value }

/**
 * Вернуть закэшированное значение или загрузить через loader и закэшировать.
 * @param {string} key
 * @param {() => Promise<any>} loader
 * @param {number} [ttl]
 */
async function cached(key, loader, ttl = TTL_MS) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await loader();
  store.set(key, { at: Date.now(), value });
  return value;
}

/** Сбросить кэш целиком (без аргументов) либо перечисленные ключи. */
function invalidate(...keys) {
  if (!keys.length) {
    store.clear();
    return;
  }
  keys.forEach(k => store.delete(k));
}

module.exports = { cached, invalidate, TTL_MS };
