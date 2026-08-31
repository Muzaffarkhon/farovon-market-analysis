// Список ролей теперь в таблице `roles`, а не только в коде. Здесь — чтение с
// коротким кэшем (роли меняются редко, а дёргаются на каждом saveUser).

const { queryAll } = require('../db/database');
const { ROLES, RESERVED_ROLE_KEYS, ROLE_LABELS } = require('../config/capabilities');

let cache = null;
let cachedAt = 0;
const TTL_MS = 30 * 1000;

/** Полный список ролей из БД: [{ key, label, is_protected, sort }]. */
async function getRoles() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  try {
    const rows = await queryAll('SELECT key, label, is_protected, sort FROM roles ORDER BY sort ASC, key ASC');
    if (rows && rows.length) {
      cache = rows.map(r => ({
        key: r.key,
        label: r.label || r.key,
        is_protected: !!r.is_protected,
        sort: r.sort
      }));
      cachedAt = Date.now();
      return cache;
    }
  } catch (e) {
    // таблицы ещё нет (сервер поднялся раньше миграции) — отдаём фолбэк из кода
  }
  // Фолбэк: зарезервированные ключи из капабилити-конфига.
  return RESERVED_ROLE_KEYS.map((key, i) => ({
    key,
    label: ROLE_LABELS[key] || key,
    is_protected: true,
    sort: i * 10
  }));
}

/** Только ключи ролей. */
async function getRoleKeys() {
  return (await getRoles()).map(r => r.key);
}

/** Сбросить кэш после изменения таблицы ролей. */
function invalidate() {
  cache = null;
  cachedAt = 0;
}

module.exports = { getRoles, getRoleKeys, invalidate, DEFAULT_ROLE_KEYS: ROLES };
