'use strict';

/**
 * ID-связь «пользователь ↔ подразделение» (head/resp/hrbp), в дополнение к
 * текстовым divisions.head/resp/hrbp. Текстовые поля остаются источником
 * отображаемого имени (и правятся тем же способом, что и раньше — свободным
 * текстом в админке), но решение «моё ли это подразделение» для прав доступа
 * должно опираться на ID: переименование пользователя не должно разрывать
 * его права на подразделение (см. docs/superpowers/specs — миграция ТЗ п.12.5).
 */

const { queryAll, run } = require('../db/database');
const { splitFioList, findUserByFioFlexible } = require('./fioResolver');

/**
 * Пересобрать назначения одного вида ('head'|'resp'|'hrbp') для подразделения
 * из текущего текстового значения поля. Вызывается сразу после того, как
 * само текстовое поле записано в divisions — так division_assignments
 * никогда не расходится с тем, что реально сохранено.
 */
async function resyncDivisionAssignments(divisionId, kind, fioText) {
  if (!divisionId) return;
  await run('DELETE FROM division_assignments WHERE division_id = ? AND kind = ?', [divisionId, kind]);
  const names = splitFioList(fioText);
  for (const name of names) {
    const user = await findUserByFioFlexible(name);
    if (user) {
      await run(
        'INSERT OR IGNORE INTO division_assignments (division_id, user_id, kind) VALUES (?, ?, ?)',
        [divisionId, user.id, kind]
      );
    }
  }
}

/** Названия подразделений (divisions.unit), где userId закреплён с данным kind. */
async function unitsForUser(userId, kind) {
  if (!userId) return new Set();
  const rows = await queryAll(
    `SELECT d.unit FROM division_assignments a JOIN divisions d ON d.id = a.division_id
      WHERE a.user_id = ? AND a.kind = ?`,
    [userId, kind]
  );
  return new Set(rows.map(r => r.unit));
}

module.exports = { resyncDivisionAssignments, unitsForUser };
