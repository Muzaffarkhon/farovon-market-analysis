const { queryAll, run } = require('./database');
const { ROLES, DEFAULT_ROLE_CAPABILITIES } = require('../config/capabilities');

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

  // Штатное расписание: должность привязана к конкретному подразделению, а не
  // к направлению. Направления оказались слишком крупной единицей — в исходном
  // штатном расписании 1340 пар «должность × отдел» по 285 отделам, и именно
  // такой список нужен руководителю на шаге 2.
  await run(`CREATE TABLE IF NOT EXISTS unit_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit TEXT NOT NULL,
    position TEXT NOT NULL,
    staff_count INTEGER DEFAULT 0,
    UNIQUE(unit, position)
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_unit_positions_unit ON unit_positions(unit)');

  // Коды-идентификаторы. В исходных таблицах они были у всего (П53, К136, код
  // отдела 529), при переносе в базу потерялись — а по ним сверяют данные с
  // бухгалтерией и штатным расписанием.
  await ensureColumn('divisions', 'code', 'TEXT');
  await ensureColumn('dictionary_companies', 'code', 'TEXT');
  await ensureColumn('dictionary_positions', 'code', 'TEXT');

  // Смежная группа: несколько подразделений с одинаковой структурой
  // должностей, отличающихся только площадкой (например «Служба охраны
  // Анхор/ТМК/Фаровон/Навобод»). Проставляется вручную админом — угадывать
  // похожесть по названию на живых данных ненадёжно (единообразия в именах
  // нет). Используется, чтобы не заставлять человека вводить одни и те же
  // должности и компании по нескольку раз для каждой площадки отдельно.
  await ensureColumn('divisions', 'group_key', 'TEXT');

  // Родительский отдел (Уровень 3→4): если подразделение является подотделом
  // другого отдела, а не напрямую направления. Например: «Отдел оценки и
  // вознаграждения» подчиняется «Управлению по работе с персоналом», которое
  // в свою очередь относится к «Департаменту развития».
  // NULL = прямое подчинение направлению (dir), без промежуточного родителя.
  await ensureColumn('divisions', 'parent_unit', 'TEXT DEFAULT NULL');

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

  // Конструктор ролей и доступов. 'admin' сюда никогда не пишется — у него
  // все права всегда, без исключений (см. src/config/capabilities.js).
  // Сиды 1:1 повторяют requireRoles(...), стоявший на маршрутах до этой
  // правки, — миграция на живой базе не должна никого лишить доступа,
  // который уже был.
  await run(`CREATE TABLE IF NOT EXISTS role_capabilities (
    role TEXT NOT NULL,
    capability TEXT NOT NULL,
    PRIMARY KEY (role, capability)
  )`);

  // Всегда гарантируем наличие прав по умолчанию для каждой роли
  for (const role of ROLES) {
    const caps = DEFAULT_ROLE_CAPABILITIES[role] || [];
    for (const cap of caps) {
      await run('INSERT OR IGNORE INTO role_capabilities (role, capability) VALUES (?, ?)', [role, cap]);
    }
  }
  console.log('🔧 Миграция: права ролей по умолчанию проверены и синхронизированы');

  // Корпоративная роль подразделения (governance / control / line)
  // и флаг участия в C&B обзорах рынка (1 — участвует, 0 — исключено)
  await ensureColumn('divisions', 'org_role', "TEXT DEFAULT 'line'");
  await ensureColumn('divisions', 'is_survey_target', "INTEGER DEFAULT 1");

  // Автоматическая инициализация роли 'control' для служб внутреннего аудита
  await run("UPDATE divisions SET org_role = 'control' WHERE (unit LIKE '%аудит%' OR dir LIKE '%аудит%') AND (org_role IS NULL OR org_role = 'line')");

  // Составные индексы для мгновенной выборки и ускорения работы
  await run('CREATE INDEX IF NOT EXISTS idx_competitors_unit_actual ON competitors(unit, actual)');
  await run('CREATE INDEX IF NOT EXISTS idx_surveys_unit_state ON surveys(unit, state)');
  await run('CREATE INDEX IF NOT EXISTS idx_divisions_dir ON divisions(dir)');
  await run('CREATE INDEX IF NOT EXISTS idx_divisions_org_role ON divisions(org_role)');
  await run('CREATE INDEX IF NOT EXISTS idx_dict_companies_name ON dictionary_companies(name)');
  await run('CREATE INDEX IF NOT EXISTS idx_dict_positions_name ON dictionary_positions(name)');

  // Объединение дубликатов ФИО и дописывание отчеств вынесено в РУЧНЫЕ скрипты —
  // на старте оно не запускается. Эвристика слияния (совпадение фамилии + ещё
  // одного токена) может склеить разных людей-однофамильцев и архивирует аккаунт
  // необратимо, поэтому её нельзя гонять по боевой базе при каждом деплое.
  // Разовая чистка, под присмотром и с бэкапом:
  //   node src/tools/mergeDuplicateUsers.js
  //   node src/tools/enrichFullFio.js
}

module.exports = { migrate, ensureColumn };
