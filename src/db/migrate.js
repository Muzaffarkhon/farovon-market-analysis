const { queryAll, run } = require('./database');

/**
 * Идемпотентные миграции живой базы.
 *
 * Раньше каждое изменение схемы приходилось выполнять руками в консоли Turso
 * (так добавляли users.archived_at), и об этом легко забыть — на Render код
 * выкатывается автоматически, а база остаётся старой, и эндпоинт падает уже
 * на проде. Поэтому изменения схемы выполняются при старте сервера и
 * рассчитаны на повторный запуск: колонка добавляется, только если её нет,
 * таблица создаётся через IF NOT EXISTS.
 *
 * Наполнять справочники сегментов/регионов начальными значениями тоже надо
 * здесь: до появления этих таблиц значения жили только внутри строк компаний,
 * и без переноса админ увидел бы пустой справочник при 60 живых сегментах.
 */
async function ensureColumn(table, column, definition) {
  const cols = await queryAll(`PRAGMA table_info(${table})`);
  if (cols.some(c => c.name === column)) return false;
  await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`🔧 Миграция: ${table}.${column} добавлена`);
  return true;
}

async function migrate() {
  // Направления, к которым админ прикрепляет компанию. Хранится строкой через
  // ';' — тем же разделителем, что и users.units, чтобы не заводить в проекте
  // второй формат списка.
  await ensureColumn('dictionary_companies', 'dirs', 'TEXT DEFAULT \'\'');

  // Должность в справочнике общая для холдинга, но админ ведёт её по
  // направлениям — иначе список из 216 позиций одинаков для всех 326
  // подразделений и выбирать в нём невозможно.
  await ensureColumn('dictionary_positions', 'dirs', 'TEXT DEFAULT \'\'');

  await run(`CREATE TABLE IF NOT EXISTS dictionary_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS dictionary_regions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  )`);

  // Первичное наполнение — только когда таблица пуста. Повторный запуск ничего
  // не перезатирает, иначе удалённое админом значение возвращалось бы после
  // каждого перезапуска сервера.
  const segCount = await queryAll('SELECT COUNT(*) AS n FROM dictionary_segments');
  if (!segCount[0] || !segCount[0].n) {
    await run(`INSERT OR IGNORE INTO dictionary_segments (name)
      SELECT DISTINCT TRIM(segment) FROM dictionary_companies WHERE TRIM(COALESCE(segment,'')) <> ''
      UNION SELECT DISTINCT TRIM(segment) FROM competitors WHERE TRIM(COALESCE(segment,'')) <> ''`);
    console.log('🔧 Миграция: справочник сегментов наполнен из живых данных');
  }

  const regCount = await queryAll('SELECT COUNT(*) AS n FROM dictionary_regions');
  if (!regCount[0] || !regCount[0].n) {
    await run(`INSERT OR IGNORE INTO dictionary_regions (name)
      SELECT DISTINCT TRIM(region) FROM dictionary_companies WHERE TRIM(COALESCE(region,'')) <> ''
      UNION SELECT DISTINCT TRIM(region) FROM competitors WHERE TRIM(COALESCE(region,'')) <> ''`);
    console.log('🔧 Миграция: справочник регионов наполнен из живых данных');
  }
}

module.exports = { migrate, ensureColumn };
