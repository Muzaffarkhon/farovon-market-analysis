'use strict';

const { queryOne, run } = require('../db/database');

const MAX_COLUMNS = 60;
const MAX_KEY_LEN = 40;

/** Личный набор видимых колонок таблицы (ключ + порядок) или null, если пользователь ничего не сохранял. */
async function getTablePrefs(login, tableKey) {
  const row = await queryOne('SELECT columns FROM user_table_prefs WHERE login = ? AND table_key = ?', [login, tableKey]);
  if (!row) return null;
  try {
    const columns = JSON.parse(row.columns);
    return Array.isArray(columns) ? columns : null;
  } catch (e) {
    return null;
  }
}

async function saveTablePrefs(login, tableKey, columns) {
  if (!Array.isArray(columns) || columns.length === 0 || columns.length > MAX_COLUMNS) {
    throw new Error('Некорректный список колонок');
  }
  const clean = columns.map(c => String(c).slice(0, MAX_KEY_LEN));
  await run(
    `INSERT INTO user_table_prefs (login, table_key, columns, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(login, table_key) DO UPDATE SET columns = excluded.columns, updated_at = CURRENT_TIMESTAMP`,
    [login, tableKey, JSON.stringify(clean)]
  );
  return clean;
}

module.exports = { getTablePrefs, saveTablePrefs };
