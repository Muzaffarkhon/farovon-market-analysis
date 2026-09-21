const { queryAll } = require('../db/database');

/**
 * Где подразделение уже задействовано: анкеты, конкуренты, должности по отделу,
 * дочерние подразделения, прикреплённые сотрудники. Нужно для удаления:
 * пустое (нигде не используется) удалить можно, остальное — только скрыть,
 * чтобы не потерять историю.
 *
 * Таблицы с колонкой unit ищем в самой базе, а не перечисляем вручную, — иначе
 * новая таблица, добавленная миграцией, молча выпала бы из проверки.
 *
 * Возвращает Map: название подразделения → [{ what, n }].
 */
const LABELS = {
  surveys: 'анкеты',
  competitors: 'участники рынка',
  unit_positions: 'должности в штате',
  position_company_selections: 'выбор компаний в анкетах',
  staff_directory: 'записи справочника сотрудников',
  grading_block_assignments: 'блоки грейдирования'
};

let unitTablesCache = null;
async function unitTables() {
  if (unitTablesCache) return unitTablesCache;
  const all = await queryAll("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  const found = await Promise.all(all.map(async (t) => {
    if (t.name === 'divisions') return null;
    const safe = String(t.name).replace(/"/g, '');
    try {
      const cols = await queryAll('PRAGMA table_info("' + safe + '")');
      return cols.some(c => c.name === 'unit') ? safe : null;
    } catch (e) { return null; }
  }));
  unitTablesCache = found.filter(Boolean);
  return unitTablesCache;
}

async function divisionUsageMap() {
  const map = new Map();
  const add = (unit, what, n) => {
    const key = String(unit || '').trim();
    if (!key || !(n > 0)) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ what, n });
  };

  // Список таблиц с колонкой unit не меняется между миграциями — ищем его один
  // раз на процесс, а счётчики по таблицам считаем параллельно: по сети до
  // базы каждый запрос отдельно стоит сотни миллисекунд.
  const tables = await unitTables();
  const results = await Promise.all(tables.map(async (safe) => {
    const extra = safe === 'surveys' ? " WHERE state != 'удалена'" : '';
    const rows = await queryAll('SELECT unit, COUNT(*) AS n FROM "' + safe + '"' + extra + ' GROUP BY unit');
    return { safe, rows };
  }));
  results.forEach(({ safe, rows }) => rows.forEach(r => add(r.unit, LABELS[safe] || safe, r.n)));

  const kids = await queryAll("SELECT parent_unit AS unit, COUNT(*) AS n FROM divisions WHERE COALESCE(parent_unit, '') <> '' GROUP BY parent_unit");
  kids.forEach(r => add(r.unit, 'дочерние подразделения', r.n));

  const users = await queryAll("SELECT units FROM users WHERE COALESCE(units, '') <> ''");
  const holders = new Map();
  users.forEach(u => {
    String(u.units).split(';').map(x => x.trim()).filter(Boolean).forEach(x => {
      const k = x.toLowerCase();
      holders.set(k, (holders.get(k) || 0) + 1);
    });
  });
  const divs = await queryAll('SELECT unit FROM divisions');
  divs.forEach(d => add(d.unit, 'сотрудники', holders.get(String(d.unit).trim().toLowerCase()) || 0));

  return map;
}

async function divisionUsage(unit) {
  const map = await divisionUsageMap();
  return map.get(String(unit || '').trim()) || [];
}

module.exports = { divisionUsageMap, divisionUsage };
