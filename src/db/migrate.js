const { queryAll, run } = require('./database');
const { ROLES, DEFAULT_ROLE_CAPABILITIES, RESERVED_ROLE_KEYS, ROLE_LABELS } = require('../config/capabilities');

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

  // Справочник ролей: раньше список ролей был только константой в коде. Теперь
  // он в БД, чтобы админ мог добавлять свои роли (конструктор «Роли и доступы»).
  // Зарезервированные 6 ключей помечаем is_protected — их поведение зашито в
  // код, удалять/переименовывать ключ нельзя (см. RESERVED_ROLE_KEYS).
  await run(`CREATE TABLE IF NOT EXISTS roles (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    is_protected INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 100
  )`);
  const seedRoles = [
    ['admin', 0], ['cb', 10], ['hrbp', 20], ['dir_head', 30], ['head', 40], ['user', 50]
  ];
  for (const [key, sort] of seedRoles) {
    await run(
      'INSERT OR IGNORE INTO roles (key, label, is_protected, sort) VALUES (?, ?, 1, ?)',
      [key, ROLE_LABELS[key] || key, sort]
    );
  }
  console.log('🔧 Миграция: справочник ролей (roles) синхронизирован');

  // Защита от брутфорса пароля: счётчик подряд идущих неудачных входов и время,
  // до которого вход по паролю для этой учётки запрещён. Логика — в
  // authController.login (порог и длительность блокировки задаются там).
  await ensureColumn('users', 'failed_login_count', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('users', 'locked_until', 'DATETIME');

  // Вошёл по временному паролю (бот /login или сброс админом) — обязан сменить
  // его при первом входе. Флаг ставит telegramController, снимает changePassword.
  await ensureColumn('users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');

  // График работы у конкурента (например «6/1-54 часов»). Собирается и в
  // карточке сбора данных, и приходит из импорта опроса зарплат — раньше
  // отдельного поля не было и значение терялось в примечании.
  await ensureColumn('surveys', 'schedule', "TEXT DEFAULT ''");

  // Оклад Фаровона по должности — эталон для колонок «Мы» и «Гэп к рынку» на
  // дашборде вилок. Хранится в справочнике должностей (holding-wide, без грейдов),
  // заполняется админом в разделе «Справочники → Должности».
  await ensureColumn('dictionary_positions', 'pay_from', 'REAL DEFAULT 0');
  await ensureColumn('dictionary_positions', 'pay_to', 'REAL DEFAULT 0');

  // Корпоративная роль подразделения (governance / control / line)
  // и флаг участия в C&B обзорах рынка (1 — участвует, 0 — исключено)
  await ensureColumn('divisions', 'org_role', "TEXT DEFAULT 'line'");
  await ensureColumn('divisions', 'is_survey_target', "INTEGER DEFAULT 1");

  // Автоматическая инициализация роли 'control' для служб внутреннего аудита
  await run("UPDATE divisions SET org_role = 'control' WHERE (unit LIKE '%аудит%' OR dir LIKE '%аудит%') AND (org_role IS NULL OR org_role = 'line')");

  // Комментарий по подразделению (свободный текст)
  await ensureColumn('divisions', 'survey_note', "TEXT DEFAULT ''");

  // ============================================================
  // Мультиисточниковый бенчмаркинг вознаграждений (Фаза 1)
  // ============================================================

  await run(`CREATE TABLE IF NOT EXISTS data_sources (
    key TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    kind TEXT NOT NULL, -- 'internal', 'jobsite', 'consultancy'
    is_licensed INTEGER NOT NULL DEFAULT 0,
    default_currency TEXT DEFAULT 'сомони',
    notes TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS benchmark_datasets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_key TEXT NOT NULL,
    title TEXT NOT NULL,
    report_date TEXT,
    data_as_of TEXT,
    currency TEXT DEFAULT 'сомони',
    methodology TEXT,
    uploaded_by TEXT,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    row_count INTEGER DEFAULT 0,
    state TEXT DEFAULT 'active', -- 'draft', 'active', 'archived'
    FOREIGN KEY (source_key) REFERENCES data_sources(key)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS source_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_key TEXT NOT NULL,
    code TEXT,
    label TEXT NOT NULL,
    family TEXT,
    UNIQUE(source_key, label),
    FOREIGN KEY (source_key) REFERENCES data_sources(key)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS position_map (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dict_position_id INTEGER NOT NULL,
    source_position_id INTEGER NOT NULL,
    confidence TEXT DEFAULT 'exact', -- 'exact', 'close', 'approx'
    note TEXT,
    mapped_by TEXT,
    mapped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(dict_position_id, source_position_id),
    FOREIGN KEY (dict_position_id) REFERENCES dictionary_positions(id),
    FOREIGN KEY (source_position_id) REFERENCES source_positions(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS benchmark_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL,
    source_position_id INTEGER NOT NULL,
    region TEXT,
    industry TEXT,
    company_size TEXT,
    grade TEXT,
    component TEXT DEFAULT 'base', -- 'base', 'total_cash', 'total_remuneration'
    currency TEXT DEFAULT 'сомони',
    period TEXT DEFAULT 'в месяц',
    stat_type TEXT NOT NULL, -- 'point', 'p10', 'p25', 'p50', 'p75', 'p90', 'avg', 'min', 'max'
    value REAL NOT NULL,
    sample_n INTEGER DEFAULT 1,
    company TEXT,
    FOREIGN KEY (dataset_id) REFERENCES benchmark_datasets(id),
    FOREIGN KEY (source_position_id) REFERENCES source_positions(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS fx_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    currency TEXT NOT NULL,
    date TEXT NOT NULL,
    rate_to_base REAL NOT NULL, -- курс к сомони (TJS = 1)
    UNIQUE(currency, date)
  )`);

  await run('CREATE INDEX IF NOT EXISTS idx_benchmark_rows_dataset ON benchmark_rows(dataset_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_benchmark_rows_pos ON benchmark_rows(source_position_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_source_positions_source ON source_positions(source_key)');
  await run('CREATE INDEX IF NOT EXISTS idx_position_map_dict ON position_map(dict_position_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_position_map_source ON position_map(source_position_id)');

  // Сид базовых и расширенных источников данных рынка
  const defaultSources = [
    ['internal', 'Внутренний сбор', 'internal', 0, 'сомони', 'Точечные наблюдения по компаниям-конкурентам от HR BP и руководителей подразделений'],
    ['b1', 'B1 (Ernst & Young)', 'consultancy', 1, 'USD', 'Ежегодный лицензионный обзор заработных плат и компенсаций B1 Salary Survey'],
    ['antal', 'Antal International', 'consultancy', 1, 'USD', 'Исследование рынка труда и компенсаций Antal'],
    ['korn_ferry', 'Korn Ferry (Hay Group)', 'consultancy', 1, 'USD', 'Глобальный обзор заработных плат и грейдов Korn Ferry Hay Group'],
    ['pwc', 'PwC Pay & Benefits', 'consultancy', 1, 'USD', 'Обзор заработных плат и систем премирования PwC'],
    ['mercer', 'Mercer TRS', 'consultancy', 1, 'USD', 'Total Remuneration Survey (TRS) Mercer'],
    ['hh_ru', 'HeadHunter (Банк данных ЗП)', 'jobsite', 1, 'RUB', 'Аналитическая база реальных заработных плат HeadHunter'],
    ['job_farovon', 'Job Farovon / Somon.tj', 'jobsite', 0, 'сомони', 'Выгрузка вакансий и резюме с джоб-платформы Farovon, Somon.tj и локальных сайтов'],
    ['stat_tj', 'Агентство по статистике РТ', 'official', 0, 'сомони', 'Официальные данные о средней заработной плате по отраслям Республики Таджикистан'],
    ['partner_survey', 'Партнёрский C&B обмен', 'direct', 0, 'сомони', 'Прямой опрос и обмен обезличенными вилками с доверенными компаниями-партнерами']
  ];
  for (const [key, title, kind, is_licensed, default_currency, notes] of defaultSources) {
    await run(
      'INSERT OR IGNORE INTO data_sources (key, title, kind, is_licensed, default_currency, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [key, title, kind, is_licensed, default_currency, notes]
    );
  }
  console.log('🔧 Миграция: таблицы бенчмаркинга и базовые источники инициализированы');
}

module.exports = { migrate, ensureColumn };
