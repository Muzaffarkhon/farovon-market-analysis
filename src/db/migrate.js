const { queryAll, queryOne, run, batch } = require('./database');
const { ROLES, DEFAULT_ROLE_CAPABILITIES, RESERVED_ROLE_KEYS, ROLE_LABELS } = require('../config/capabilities');
const { GROUP_FACTORS, RISK_FACTORS } = require('../config/gradingFactors');
const { POSITION_HINTS } = require('../config/gradingPositionHints');

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

/**
 * Первичная заливка формулировок анкеты из кода в таблицу grading_factors.
 * dir = '' — общая формулировка, действует для всех направлений холдинга;
 * строки с конкретным направлением заводит C&B в админке поверх неё.
 */
async function seedFactors(scope, list) {
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    await run(
      `INSERT OR IGNORE INTO grading_factors
         (scope, idx, dir, code, title, help, option_1, option_2, option_3, option_4, option_5, updated_by)
       VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, 'исходная форма')`,
      [scope, i + 1, f.code, f.title, f.help || '', ...f.options]
    );
  }
}

/**
 * Переход на формулировки по направлениям: у таблицы было UNIQUE(scope, idx),
 * из-за чего второй вариант того же вопроса «под мукомолов» вставить нельзя.
 * SQLite не умеет менять ограничение на месте — пересобираем таблицу и
 * переносим строки (их немного: 13 вопросов грейдирования и 4 про риски).
 */
async function upgradeGradingFactorsToDirs() {
  const cols = await queryAll('PRAGMA table_info(grading_factors)');
  if (!cols.length || cols.some(c => c.name === 'dir')) return;

  await run(`CREATE TABLE grading_factors_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    idx INTEGER NOT NULL,
    dir TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    help TEXT,
    option_1 TEXT NOT NULL,
    option_2 TEXT NOT NULL,
    option_3 TEXT NOT NULL,
    option_4 TEXT NOT NULL,
    option_5 TEXT NOT NULL,
    updated_by TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(scope, idx, dir)
  )`);
  await run(`INSERT INTO grading_factors_new
      (id, scope, idx, dir, code, title, help, option_1, option_2, option_3, option_4, option_5, updated_by, updated_at)
    SELECT id, scope, idx, '', code, title, help, option_1, option_2, option_3, option_4, option_5, updated_by, updated_at
      FROM grading_factors`);
  await run('DROP TABLE grading_factors');
  await run('ALTER TABLE grading_factors_new RENAME TO grading_factors');
  console.log('🔧 Миграция: формулировки анкет переведены на разрез по направлениям');
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

  // Прошёл обучающий тур по интерфейсу. Раньше факт прохождения жил только в
  // localStorage браузера (LS_OB) — с нового устройства или после очистки
  // хранилища тур навязывался заново. Теперь это отметка на учётке: ставит её
  // POST /api/auth/onboarded по завершении тура или по «Понятно, скрыть»,
  // снять её может только сам пользователь (повторно тур не всплывает).
  await ensureColumn('users', 'onboarded_at', 'DATETIME');

  // График работы у конкурента (например «6/1-54 часов»). Собирается и в
  // карточке сбора данных, и приходит из импорта опроса зарплат — раньше
  // отдельного поля не было и значение терялось в примечании.
  await ensureColumn('surveys', 'schedule', "TEXT DEFAULT ''");

  // Переменная часть несколькими видами сразу: [{type,size,per}] в JSON.
  // Колонки bon_has/bon_size/bon_type/bon_per остаются и держат ПЕРВЫЙ элемент
  // массива — на них завязаны аналитика, воркер, импорт и дашборды вилок.
  // Пусто/'[]' у старых записей = один бонус, читается из bon_* (см. mapSurveyRow).
  await ensureColumn('surveys', 'bonuses', "TEXT DEFAULT ''");

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

  // Регион подразделения — структурный разрез для дашборда (особенно продажи:
  // одинаковые роли по городам, а оклады различаются). Проставляет админ в
  // карточке подразделения; у наблюдений (surveys) своего региона нет — берётся
  // отсюда, по подразделению.
  await ensureColumn('divisions', 'region', "TEXT DEFAULT ''");

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
  // Годовой архив обзора рынка: анкета получает жёсткую привязку к периоду
  // сбора (period_id → periods.id) вместо неиспользуемой текстовой метки
  // period. Нужно, чтобы дашборд мог фильтровать по году, а форма заполнения
  // — не путать анкеты этого года с прошлогодними (см. docs/superpowers/
  // specs/2026-09-04-yearly-archive-design.md).
  const addedPeriodId = await ensureColumn('surveys', 'period_id', 'INTEGER REFERENCES periods(id)');
  await run('CREATE INDEX IF NOT EXISTS idx_surveys_period ON surveys(period_id)');
  if (addedPeriodId) {
    // Все анкеты, заполненные до этой миграции, считаются первым годом
    // архива — переносим их на самый первый (старейший) период сбора.
    const firstPeriod = await queryOne('SELECT id FROM periods ORDER BY id ASC LIMIT 1');
    if (firstPeriod) {
      await run('UPDATE surveys SET period_id = ? WHERE period_id IS NULL', [firstPeriod.id]);
      console.log(`🔧 Миграция: surveys.period_id проставлен для существующих анкет (период #${firstPeriod.id})`);
    }
  }

  // Точечный доступ к редактированию архивного года — см. docs/superpowers/
  // specs/2026-09-05-archive-edit-access-design.md. UNIQUE(user_login,
  // period_id) — повторная выдача тому же человеку на тот же год обновляет
  // срок, а не плодит дубликаты (см. adminController.grantPeriodEdit).
  await run(`CREATE TABLE IF NOT EXISTS period_edit_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_login TEXT NOT NULL,
    period_id INTEGER NOT NULL REFERENCES periods(id),
    granted_by TEXT NOT NULL,
    granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    UNIQUE(user_login, period_id)
  )`);

  // Восстановление периода: «текущий период» больше не «самая новая строка»,
  // а строка с is_active = 1. Это позволяет вернуть прошлый период активным
  // (закрыли/открыли новый по ошибке), не создавая копию с новым id и не
  // отвязывая анкеты по surveys.period_id (см. docs/superpowers/specs/
  // 2026-09-06-period-restore-design.md).
  const addedIsActive = await ensureColumn('periods', 'is_active', 'INTEGER NOT NULL DEFAULT 0');
  if (addedIsActive) {
    // До этой миграции текущим считался новейший период — переносим на него.
    await run(`UPDATE periods SET is_active = 1
               WHERE id = (SELECT id FROM periods ORDER BY id DESC LIMIT 1)`);
    console.log('🔧 Миграция: periods.is_active проставлен новейшему периоду');
  }
  // Страховка от рассинхрона (ручная правка БД, сбой в середине операции):
  // если активной строки нет вовсе — активировать новейшую.
  await run(`UPDATE periods SET is_active = 1
             WHERE id = (SELECT id FROM periods ORDER BY id DESC LIMIT 1)
               AND NOT EXISTS (SELECT 1 FROM periods WHERE is_active = 1)`);

  // Грейдирование должностей (PLAN_GRADING_AND_KEY_PERSONNEL.md, раздел 2).
  // Оценивается требование к функции, а не человек: подразделение + должность +
  // группа факторов. factor_4 заполняется только у производственной группы —
  // у остальных трёх факторов три, поэтому колонка допускает NULL.
  await run(`CREATE TABLE IF NOT EXISTS job_evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit TEXT NOT NULL,
    job_title TEXT NOT NULL,
    group_type TEXT NOT NULL,
    factor_1 INTEGER NOT NULL CHECK(factor_1 BETWEEN 1 AND 5),
    factor_2 INTEGER NOT NULL CHECK(factor_2 BETWEEN 1 AND 5),
    factor_3 INTEGER NOT NULL CHECK(factor_3 BETWEEN 1 AND 5),
    factor_4 INTEGER CHECK(factor_4 IS NULL OR factor_4 BETWEEN 1 AND 5),
    weighted_score REAL NOT NULL,
    grade_level INTEGER NOT NULL,
    evaluated_by TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_job_eval_unit ON job_evaluations(unit)');
  await run('CREATE INDEX IF NOT EXISTS idx_job_eval_title ON job_evaluations(job_title)');
  // Повторная оценка той же должности в том же подразделении перезаписывает
  // прошлую, а не плодит две строки с разными грейдами.
  await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_job_eval_unit_title ON job_evaluations(unit, job_title)');

  // Тексты анкет: формулировки факторов и расшифровка баллов 1–5. Живут в
  // базе, а не только в коде, чтобы C&B правил вопросы сам через админку.
  // Значения из src/config/gradingFactors.js остаются эталоном и заливаются
  // сюда один раз (INSERT OR IGNORE) — правки админа они не перетирают.
  await run(`CREATE TABLE IF NOT EXISTS grading_factors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    idx INTEGER NOT NULL,
    dir TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    help TEXT,
    option_1 TEXT NOT NULL,
    option_2 TEXT NOT NULL,
    option_3 TEXT NOT NULL,
    option_4 TEXT NOT NULL,
    option_5 TEXT NOT NULL,
    updated_by TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(scope, idx, dir)
  )`);
  // Базы, созданные до появления разреза по направлениям, доводим до нового
  // вида: колонка dir и уникальность по тройке (анкета, вопрос, направление).
  await upgradeGradingFactorsToDirs();
  for (const [scope, list] of Object.entries(GROUP_FACTORS)) {
    await seedFactors(scope, list);
  }
  await seedFactors('risk', RISK_FACTORS);

  // Риски незаменимости ключевого персонала. Здесь, в отличие от
  // грейдирования, оценивается конкретный сотрудник (ФИО), поэтому строки
  // отдаются только своему подразделению, C&B и администратору.
  await run(`CREATE TABLE IF NOT EXISTS key_personnel_risks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit TEXT NOT NULL,
    employee_fio TEXT NOT NULL,
    job_title TEXT NOT NULL,
    bus_factor INTEGER NOT NULL CHECK(bus_factor BETWEEN 1 AND 5),
    replacement_time INTEGER NOT NULL CHECK(replacement_time BETWEEN 1 AND 5),
    knowledge_monopoly INTEGER NOT NULL CHECK(knowledge_monopoly BETWEEN 1 AND 5),
    financial_risk INTEGER NOT NULL CHECK(financial_risk BETWEEN 1 AND 5),
    total_risk_score INTEGER NOT NULL,
    risk_status TEXT NOT NULL,
    action_plan TEXT NOT NULL,
    evaluator_user_id INTEGER,
    evaluator_fio TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_key_personnel_unit ON key_personnel_risks(unit)');
  await run('CREATE INDEX IF NOT EXISTS idx_key_personnel_status ON key_personnel_risks(risk_status)');
  // Один сотрудник на одной должности в подразделении — одна актуальная
  // анкета риска; повторная отправка обновляет её.
  await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_key_personnel_person ON key_personnel_risks(unit, employee_fio, job_title)');

  // Синхронизация пользователей с оргструктурой и штатным расписанием 1С (2026-09-09).
  // Обычные сотрудники сняты с общедепартаментских «шапок» и привязаны к конкретным
  // заводам/цехам/отделам; руководители отделов переведены в роль head; актуализированы
  // руководство Департамента снабжения и логистики (Пономарев Олег) и Отдела кадров (Худойдотов Рустам).
  await run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  const orgFixApplied = await queryOne("SELECT name FROM schema_migrations WHERE name = '20260909_org_structure_fix'");
  if (!orgFixApplied) {
    const userUpdates = [
      { login: 'ashurov.a', newUnits: 'Лаборатория масло', newRole: 'user' },
      { login: 'bakoev.mh', newUnits: 'Завод РБУ Гозиен 4-5', newRole: 'user' },
      { login: 'buzurukov.ha', newUnits: 'Мукомольный завод Ф1', newRole: 'user' },
      { login: 'vohidov.mm', newUnits: '0201 Отдел оптовых продаж Худжанд', newRole: 'user' },
      { login: 'gafurov.hk', newUnits: 'Цех розлива и фасовки 1', newRole: 'user' },
      { login: 'kenchaev.ea', newUnits: 'Комбикормовый завод К1', newRole: 'user' },
      { login: 'machidov.n', newUnits: 'Отдел оптовых продаж масла', newRole: 'user' },
      { login: 'nasulloev.n', newUnits: 'Завод металлоконструкций и СП', newRole: 'user' },
      { login: 'homidov.m', newUnits: 'Завод металлоконструкций и СП', newRole: 'user' },
      { login: 'rahmonzoda.m', newUnits: 'Отдел оценки и вознограждения персонала', newRole: 'user' },
      { login: 'hakimov.mn2', newUnits: 'Департамент продаж мясной продукции', newRole: 'user' },
      { login: 'shermatov.i', newUnits: 'Убойный комплекс', newRole: 'user' },
      { login: 'holova.n', newUnits: 'Правление', newRole: 'user' },
      { login: 'ahmedov.dg', newUnits: 'Казначейство; Отдел банковских операций; Отдел кассовых операций', newRole: 'head' },
      { login: 'bahodurova.sa', newUnits: 'Академия Фаровон', newRole: 'head' },
      { login: 'ikromchon.k', newUnits: 'Отдел аналитики', newRole: 'head' },
      { login: 'mahmadov.ss', newUnits: 'Отдел монтажа; Отдел сварочных работ; Отдел строительства', newRole: 'head' },
      { login: 'samadova.f', newUnits: 'Отдел оценки и вознограждения персонала', newRole: 'head' },
      { login: 'kosimov.ug', newUnits: 'Отдел финансовой отчетности и анализа', newRole: 'head' },
      { login: 'rahmatov.mm', newUnits: 'Проектно-конструкторский отдел', newRole: 'head' },
      { login: 'obidov.fm', newUnits: 'Управление элеваторами и складами готовой продукции; Отдел складов готовой продукции; Склад ГП К1 Фаровон; Склад ГП К2 ТМК; Склад ГП МЗ T1; Склад ГП МЗ T2; Склад ГП МЗ Анхор; Склад ГП МЗ Переработка 1; Склад ГП МЗ Ф1; Склад ГП Раст.масла; Элеваторная Анхор; Элеваторная ТМК', newRole: 'head' },
      { login: 'churaev.ra', newUnits: 'Департамент производства комбикормов; Комбикормовый завод К1; Производственный цех К1; Цех упаковки К1; Элеваторная К1; Комбикормовый завод К2; Производственный цех К2; Цех упаковки К2; Элеваторная К2; Отдел лаборатории К', newRole: 'dir_head' },
      { login: 'saydulloev.br', newUnits: 'Отдел оценки и вознограждения персонала; Академия Фаровон; Отдел аналитики; Отдел развитии систем; Процессный офис', newRole: 'head' },
      { login: 'hudoydotov.r', newUnits: 'Отдел кадрового делопроизводства', newRole: 'head' },
      { login: 'mutribahon.s', newUnits: '', newRole: 'user' },
      { login: 'samandarov.z', newUnits: '', newRole: 'user' }
    ];
    for (const u of userUpdates) {
      await run('UPDATE users SET units = ?, role = ? WHERE login = ?', [u.newUnits, u.newRole, u.login]);
    }
    await run(
      "UPDATE divisions SET head = 'Худойдотов Рустам', resp = 'Худойдотов Рустам, Каримов Дилшодчон Зафарчонович' WHERE unit = 'Отдел кадрового делопроизводства'"
    );
    await run("INSERT INTO schema_migrations (name) VALUES ('20260909_org_structure_fix')");
    console.log('🔧 Миграция: оргструктура и привязка пользователей синхронизированы с 1С');
  }

  console.log('🔧 Миграция: таблицы бенчмаркинга и базовые источники инициализированы');

  // Перестройка грейдирования на индустриальные блоки и коллегиальную слепую
  // оценку (см. docs/superpowers/specs — план от 2026-09-12). Старая
  // job_evaluations (по подразделению) не трогается, новая модель ведётся
  // параллельно в grading_committee_* до переноса данных.
  await run(`CREATE TABLE IF NOT EXISTS grading_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    sort INTEGER DEFAULT 100,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS grading_block_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_key TEXT NOT NULL REFERENCES grading_blocks(key),
    unit TEXT NOT NULL,
    position TEXT NOT NULL,
    UNIQUE(unit, position)
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_grading_block_assignments_block ON grading_block_assignments(block_key)');

  // Формулировки анкеты по блоку — тот же принцип, что и разрез по dir, но
  // ключ группировки не 26 направлений оргструктуры, а укрупнённый блок.
  await ensureColumn('grading_factors', 'block', "TEXT NOT NULL DEFAULT ''");

  await run(`CREATE TABLE IF NOT EXISTS grading_committee_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_key TEXT NOT NULL REFERENCES grading_blocks(key),
    user_login TEXT NOT NULL,
    UNIQUE(block_key, user_login)
  )`);

  // Слепая индивидуальная оценка эксперта комиссии по паре «должность+блок».
  // Уникальность гарантирует, что у одного эксперта одна оценка на пару —
  // повторная отправка обновляет её, а не плодит копию.
  await run(`CREATE TABLE IF NOT EXISTS grading_committee_evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_key TEXT NOT NULL,
    job_title TEXT NOT NULL,
    evaluator_login TEXT NOT NULL,
    factor_1 INTEGER NOT NULL CHECK(factor_1 BETWEEN 1 AND 5),
    factor_2 INTEGER NOT NULL CHECK(factor_2 BETWEEN 1 AND 5),
    factor_3 INTEGER NOT NULL CHECK(factor_3 BETWEEN 1 AND 5),
    factor_4 INTEGER CHECK(factor_4 IS NULL OR factor_4 BETWEEN 1 AND 5),
    weighted_score REAL NOT NULL,
    notes TEXT,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(block_key, job_title, evaluator_login)
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_grading_committee_eval_pair ON grading_committee_evaluations(block_key, job_title)');
  // Забыли при первом проектировании таблицы — без своей группы для эксперта
  // не посчитать вес факторов при подведении итога комиссии.
  await ensureColumn('grading_committee_evaluations', 'group_type', "TEXT NOT NULL DEFAULT 'production'");

  // Итог по должности в блоке — среднее из сданных индивидуальных оценок;
  // пересчитывается сервисом, когда сдают все члены комиссии или админ
  // закрывает раунд. evaluators_done/total — для прогресса в UI без раскрытия
  // самих баллов до завершения.
  await run(`CREATE TABLE IF NOT EXISTS grading_block_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_key TEXT NOT NULL,
    job_title TEXT NOT NULL,
    avg_score REAL NOT NULL,
    grade_level INTEGER NOT NULL,
    evaluators_done INTEGER NOT NULL,
    evaluators_total INTEGER NOT NULL,
    finalized_at DATETIME,
    UNIQUE(block_key, job_title)
  )`);

  console.log('🔧 Миграция: схема грейдирования по индустриальным блокам и комиссии создана');

  await seedGradingBlocks();
  await upgradeJobEvaluationsToBlocks();
  await seedGradingPositionHints();
  await seedSupportChat();
}

/**
 * Чат поддержки: если бот не смог опознать человека (номер не найден, код
 * от HR неверный/просрочен и т.п.), раньше на этом всё заканчивалось —
 * бот отвечал текстом и человек оставался без выхода. Теперь у таких
 * сообщений есть кнопка «Написать администратору»: один тред на один
 * Telegram-чат, переоткрывается при новом сообщении, а не плодится заново.
 * См. docs/superpowers (перенесено из проекта «Фаровон Кафетерий», где
 * решалась та же проблема).
 */
async function seedSupportChat() {
  await run(`CREATE TABLE IF NOT EXISTS support_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_chat_id TEXT UNIQUE NOT NULL,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_support_threads_status ON support_threads(status, last_message_at)');

  await run(`CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL REFERENCES support_threads(id),
    direction TEXT NOT NULL,
    body TEXT NOT NULL,
    author_login TEXT,
    read_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages(thread_id, created_at)');

  // Готовые фразы для ответа гостю одной кнопкой — вставляются в поле ответа
  // (не отправляются сразу), C&B может править до отправки. Список
  // редактируется из самой админки, тут только стартовый набор — INSERT OR
  // IGNORE на пустую таблицу, повторный запуск миграции ничего не задублирует.
  await run(`CREATE TABLE IF NOT EXISTS support_quick_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  const qrCount = await queryOne('SELECT COUNT(*) AS n FROM support_quick_replies');
  if (!qrCount || !qrCount.n) {
    const defaults = [
      'Уточните, пожалуйста, ваше ФИО и подразделение.',
      'Проверьте номер телефона в приложении «Обзор рынка» — возможно, опечатка.',
      'Спасибо, передал ваш вопрос — ожидайте ответа.',
      'Ваш аккаунт уже привязан, наберите /login в этом чате, чтобы получить логин и пароль.',
      'По этому вопросу обратитесь, пожалуйста, к своему руководителю.'
    ];
    for (let i = 0; i < defaults.length; i++) {
      await run('INSERT INTO support_quick_replies (text, sort_order) VALUES (?, ?)', [defaults[i], i]);
    }
  }

  console.log('🔧 Миграция: схема чата поддержки Telegram-бота создана');
}

/**
 * Подсказки для комиссии на экране оценки: по каждой должности из более
 * раннего анализа — какая функциональная группа и уровень встречались у неё
 * чаще всего (см. src/config/gradingPositionHints.js). Справочная таблица,
 * не редактируется из интерфейса — INSERT OR IGNORE достаточно.
 */
async function seedGradingPositionHints() {
  await run(`CREATE TABLE IF NOT EXISTS grading_position_hints (
    position TEXT PRIMARY KEY,
    suggested_group TEXT NOT NULL,
    suggested_level INTEGER NOT NULL,
    sample_count INTEGER NOT NULL,
    group_conflict INTEGER NOT NULL DEFAULT 0,
    level_conflict INTEGER NOT NULL DEFAULT 0
  )`);

  await batch(POSITION_HINTS.map(h => ({
    sql: `INSERT OR IGNORE INTO grading_position_hints
        (position, suggested_group, suggested_level, sample_count, group_conflict, level_conflict)
      VALUES (?, ?, ?, ?, ?, ?)`,
    args: [h.position, h.group, h.level, h.sampleCount, h.groupConflict ? 1 : 0, h.levelConflict ? 1 : 0]
  })));
  console.log(`🔧 Миграция: подсказки по должностям из прежнего анализа загружены (${POSITION_HINTS.length})`);
}

/**
 * Оценка должности переходит с ключа «подразделение+должность» на
 * «блок+должность» (экран «Оценка должностей» → пользователь просил
 * список должностей по блоку вместо повторной оценки в каждом
 * подразделении). Таблица маленькая (несколько тестовых строк на момент
 * этой миграции) — пересобираем как grading_factors в своё время.
 */
async function upgradeJobEvaluationsToBlocks() {
  const cols = await queryAll('PRAGMA table_info(job_evaluations)');
  if (!cols.length || cols.some(c => c.name === 'block_key')) return;

  await run(`CREATE TABLE job_evaluations_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_key TEXT NOT NULL REFERENCES grading_blocks(key),
    job_title TEXT NOT NULL,
    unit TEXT,
    group_type TEXT NOT NULL,
    factor_1 INTEGER NOT NULL CHECK(factor_1 BETWEEN 1 AND 5),
    factor_2 INTEGER NOT NULL CHECK(factor_2 BETWEEN 1 AND 5),
    factor_3 INTEGER NOT NULL CHECK(factor_3 BETWEEN 1 AND 5),
    factor_4 INTEGER CHECK(factor_4 IS NULL OR factor_4 BETWEEN 1 AND 5),
    weighted_score REAL NOT NULL,
    grade_level INTEGER NOT NULL,
    evaluated_by TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(block_key, job_title)
  )`);

  const old = await queryAll('SELECT * FROM job_evaluations');
  let migrated = 0;
  let dropped = 0;
  for (const row of old) {
    const match = await queryOne(
      'SELECT block_key FROM grading_block_assignments WHERE unit = ? AND position = ?',
      [row.unit, row.job_title]
    );
    if (!match) { dropped++; continue; }
    await run(`INSERT INTO job_evaluations_new
        (block_key, job_title, unit, group_type, factor_1, factor_2, factor_3, factor_4,
         weighted_score, grade_level, evaluated_by, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [match.block_key, row.job_title, row.unit, row.group_type,
       row.factor_1, row.factor_2, row.factor_3, row.factor_4,
       row.weighted_score, row.grade_level, row.evaluated_by, row.notes,
       row.created_at, row.updated_at]
    );
    migrated++;
  }

  await run('DROP TABLE job_evaluations');
  await run('ALTER TABLE job_evaluations_new RENAME TO job_evaluations');
  await run('CREATE INDEX IF NOT EXISTS idx_job_eval_block ON job_evaluations(block_key)');
  await run('CREATE INDEX IF NOT EXISTS idx_job_eval_title ON job_evaluations(job_title)');
  console.log(`🔧 Миграция: оценки должностей переведены с подразделения на блок (перенесено ${migrated}, без пары в раскладке — ${dropped})`);
}

/**
 * Раскладка подразделений и должностей по индустриальным блокам грейдирования
 * (согласовано с пользователем 2026-09-12, см. память сессии
 * grading-industry-rework-plan.md). База — направление (dir) целиком; два
 * департамента физически смешаны (склад/офис, завод/офис) и раскладываются
 * по конкретному подразделению или должности. INSERT OR IGNORE — ручные
 * правки админа в grading_block_assignments эта функция не перезатирает,
 * зато на каждом старте подхватывает новые unit_positions.
 */
async function seedGradingBlocks() {
  const BLOCKS = [
    { key: 'production', label: 'Производство', sort: 10 },
    { key: 'construction', label: 'Строительный блок', sort: 20 },
    { key: 'trade', label: 'Торговля', sort: 30 },
    // Раньше «Офис-АУП» — путали с функциональной группой «АУП» (это разные
    // вещи: блок про физическое место работы, группа про анкету оценки).
    { key: 'office', label: 'Офис', sort: 40 }
  ];
  for (const b of BLOCKS) {
    await run(
      'INSERT OR IGNORE INTO grading_blocks (key, label, sort, created_by) VALUES (?, ?, ?, ?)',
      [b.key, b.label, b.sort, 'исходная раскладка']
    );
    // Название блока — не «состав», его можно поправить и после первой
    // заливки (в отличие от block_assignments, которые IGNORE не трогает
    // специально, чтобы не затирать ручные правки админа).
    await run('UPDATE grading_blocks SET label = ? WHERE key = ?', [b.label, b.key]);
  }

  const DIR_BLOCK = {
    'Департамент бройлерного направления': 'production',
    'Департамент производства комбикормов': 'production',
    'Департамент производства муки': 'production',
    'Дивизион производства масла': 'production',
    'Дивизион производства металлоизделий': 'production',
    'Птицефабрика яичного производства Д1': 'production',
    'Главная лаборатория': 'production',
    'Технический департамент': 'production',
    'Департамент капитального строительства': 'construction',
    'Дивизион строительного направления': 'construction',
    'Отдел проектирование новых проектов': 'construction',
    'Девелоперская компания': 'construction',
    'Проектный офис': 'construction',
    'Торговый Дом': 'trade',
    'Ритейл (упр)': 'trade',
    'Отдел продаж комбикормов': 'trade',
    'Департамент автоматизации и информационных технологий': 'office',
    'Департамент маркетинга': 'office',
    'Департамент по работе с государственными органами': 'office',
    'Департамент развития': 'office',
    'Финансовый департамент': 'office',
    'Правление': 'office',
    'Совет директоров': 'office'
    // 'Обзор рынка — не распределено' — служебное, вне грейдирования, не заводим
    // 'Департамент снабжения и логистики' и 'Административно-хозяйственное
    // управление' целиком не входят — физически смешаны, см. правила ниже.
  };

  // Снабжение и логистика: склады/элеваторы — физический труд на площадке,
  // закупки/логистика-координация — офисная функция.
  const SUPPLY_WAREHOUSE_UNITS = new Set([
    'Отдел складов готовой продукции',
    'Отдел управления внутренними складами',
    'Управление элеваторами и складами готовой продукции',
    'Центральный склад'
  ]);
  function classifySupplyUnit(unit) {
    if (SUPPLY_WAREHOUSE_UNITS.has(unit)) return 'production';
    if (/^Склад/.test(unit) || /Элеваторная/.test(unit)) return 'production';
    return 'office'; // Департамент снабжения и логистики, отделы закупки/логистики, служба логистики
  }

  // АХУ: площадочные хозслужбы/транспорт — производство по умолчанию, кроме
  // явно офисных должностей внутри них; центральные единицы АХУ — офис.
  const AHU_SITE_PATTERN = /^(Хозяйственная служба|Транспортный отдел|Служебный транспорт)/;
  const AHU_OFFICE_POSITIONS = new Set([
    'Бухгалтер', 'Менеджер', 'Менеджер по продажам', 'Специалист',
    'Начальник', 'Начальник отдела', 'Куратор', 'Логист', 'Старший логист',
    'Координатор', 'Диспетчер'
  ]);
  function classifyAhu(unit, position) {
    if (AHU_SITE_PATTERN.test(unit)) {
      return AHU_OFFICE_POSITIONS.has(position) ? 'office' : 'production';
    }
    return 'office'; // само АХУ, Отдел внутренней закупки, Аварийная группа
  }

  function classify(dir, unit, position) {
    if (dir === 'Департамент снабжения и логистики') return classifySupplyUnit(unit);
    if (dir === 'Административно-хозяйственное управление') return classifyAhu(unit, position);
    return DIR_BLOCK[dir] || null;
  }

  const rows = await queryAll(`
    SELECT up.unit AS unit, up.position AS position, d.dir AS dir
    FROM unit_positions up
    JOIN divisions d ON d.unit = up.unit
  `);
  // Раньше вставляли по одной паре — ~1400 отдельных запросов к удалённой
  // Turso занимали минуты на каждой сборке Vercel. batch() отправляет то же
  // самое одной сетевой поездкой (пачками, чтобы не отправить один
  // гигантский запрос) — те же минуты превращаются в секунды.
  const stmts = [];
  for (const r of rows) {
    const block = classify(r.dir, r.unit, r.position);
    if (!block) continue;
    stmts.push({
      sql: 'INSERT OR IGNORE INTO grading_block_assignments (block_key, unit, position) VALUES (?, ?, ?)',
      args: [block, r.unit, r.position]
    });
  }
  let inserted = 0;
  const CHUNK = 200;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    const results = await batch(stmts.slice(i, i + CHUNK));
    results.forEach(res => { if (res && res.rowsAffected) inserted += res.rowsAffected; });
  }
  if (inserted) {
    console.log(`🔧 Миграция: раскладка по индустриальным блокам — добавлено ${inserted} пар «подразделение+должность»`);
  }
}

module.exports = { migrate, ensureColumn };
