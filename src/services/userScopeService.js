'use strict';

/**
 * ID-связь «пользователь ↔ подразделение/направление» вместо сравнения
 * свободного текста (users.units против divisions.unit/dir). Тот же принцип,
 * что и divisionAssignmentService для head/resp/hrbp: текстовое поле
 * users.units остаётся источником для отображения и правки через
 * существующие формы, а user_division_scope/user_direction_scope —
 * источник истины для прав (переименование подразделения/направления не
 * должно рвать доступ пользователя к нему).
 *
 * units может содержать как названия подразделений (divisions.unit), так и
 * названия направлений целиком (divisions.dir — у руководителей
 * направлений). Токен, не совпавший ни с тем, ни с другим, не отбрасывается:
 * заводится как направление-плейсхолдер с этим же текстом, чтобы бэкфилл и
 * последующая синхронизация не сужали доступ, который был у пользователя
 * до миграции.
 */

const { queryOne, queryAll, run } = require('../db/database');

async function resyncUserScope(userId, unitsStr) {
  if (!userId) return;
  const tokens = String(unitsStr || '').split(';').map(s => s.trim()).filter(Boolean);

  await run('DELETE FROM user_division_scope WHERE user_id = ?', [userId]);
  await run('DELETE FROM user_direction_scope WHERE user_id = ?', [userId]);

  for (const name of tokens) {
    const div = await queryOne('SELECT id FROM divisions WHERE LOWER(unit) = LOWER(?)', [name]);
    if (div) {
      await run('INSERT OR IGNORE INTO user_division_scope (user_id, division_id) VALUES (?, ?)', [userId, div.id]);
      continue;
    }

    let dir = await queryOne('SELECT id FROM directions WHERE LOWER(name) = LOWER(?)', [name]);
    if (!dir) {
      await run('INSERT OR IGNORE INTO directions (name) VALUES (?)', [name]);
      dir = await queryOne('SELECT id FROM directions WHERE LOWER(name) = LOWER(?)', [name]);
    }
    if (dir) {
      await run('INSERT OR IGNORE INTO user_direction_scope (user_id, direction_id) VALUES (?, ?)', [userId, dir.id]);
    }
  }
}

/** Действующие названия подразделений/направлений пользователя, по ID-связи. */
async function effectiveUnitsForUser(userId) {
  if (!userId) return [];
  const [divRows, dirRows] = await Promise.all([
    queryAll(
      `SELECT d.unit AS name FROM user_division_scope s JOIN divisions d ON d.id = s.division_id WHERE s.user_id = ?`,
      [userId]
    ),
    queryAll(
      `SELECT dr.name AS name FROM user_direction_scope s JOIN directions dr ON dr.id = s.direction_id WHERE s.user_id = ?`,
      [userId]
    )
  ]);
  return [...divRows.map(r => r.name), ...dirRows.map(r => r.name)];
}

module.exports = { resyncUserScope, effectiveUnitsForUser };
