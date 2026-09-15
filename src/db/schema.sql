-- Схема базы данных SQLite для Farovon Market Analysis (C&B)

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  fio TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', -- 'admin', 'cb', 'hrbp', 'dir_head', 'head', 'user'
  phone TEXT,
  telegram_chat_id TEXT,
  telegram_link_token TEXT,
  telegram_link_expires DATETIME,
  units TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  archived_at DATETIME, -- NULL = обычный пользователь; иначе — в архиве, не виден в списке и не может войти
  failed_login_count INTEGER NOT NULL DEFAULT 0, -- подряд идущих неудачных входов; сбрасывается при успешном
  locked_until DATETIME, -- NULL = не заблокирован; иначе ISO-время, до которого вход по паролю запрещён
  must_change_password INTEGER NOT NULL DEFAULT 0, -- 1 = вошёл по временному паролю, обязан сменить
  last_login_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS divisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  num INTEGER,
  dir TEXT,
  unit TEXT UNIQUE NOT NULL,
  level TEXT,
  head TEXT,
  resp TEXT,
  hrbp TEXT,
  cnt INTEGER DEFAULT 0,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cid TEXT UNIQUE,
  num INTEGER,
  dir TEXT,
  unit TEXT NOT NULL,
  resp TEXT,
  hrbp TEXT,
  company TEXT NOT NULL,
  type TEXT,
  segment TEXT,
  region TEXT,
  prio TEXT,
  status TEXT,
  src TEXT,
  note TEXT,
  actual TEXT DEFAULT 'уточнить', -- 'актуально', 'не актуально', 'уточнить'
  updated_by TEXT,
  updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS surveys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sid TEXT UNIQUE,
  unit TEXT NOT NULL,
  company TEXT NOT NULL,
  pos_our TEXT NOT NULL,
  pos_their TEXT,
  grade TEXT,
  pay_from REAL DEFAULT 0,
  pay_to REAL DEFAULT 0,
  cur TEXT DEFAULT 'сомони',
  pay_per TEXT DEFAULT 'в месяц',
  bon_has TEXT DEFAULT 'не знаю',
  bon_size TEXT,
  bon_type TEXT,
  bon_per TEXT,
  bonuses TEXT DEFAULT '',           -- JSON [{type,size,per}]; bon_* держат первый элемент
  benefits TEXT DEFAULT '',
  schedule TEXT DEFAULT '',
  extra TEXT,
  source TEXT,
  trust TEXT,
  note TEXT,
  created_by TEXT,
  created_at DATETIME,
  state TEXT DEFAULT 'активна',
  period TEXT,
  period_id INTEGER REFERENCES periods(id)
);

-- Шаг 1 (новая модель, position-first): какие компании выбраны для сравнения
-- по КОНКРЕТНОЙ должности конкретного подразделения в конкретном периоде.
-- Заменяет собой унитарный (на весь unit) флаг competitors.actual — выбор
-- теперь делается для каждой пары «должность × компания» отдельно. Строка =
-- «эта компания отмечена как релевантная для сравнения по этой должности».
-- Отсутствие строк для пары (unit, period, pos_our) = компании ещё не выбраны
-- («не начата»); наличие строк без сохранённых surveys = «в процессе».
CREATE TABLE IF NOT EXISTS position_company_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit TEXT NOT NULL,
  period_id INTEGER REFERENCES periods(id),
  pos_our TEXT NOT NULL,
  company TEXT NOT NULL,
  selected_by TEXT,
  selected_at DATETIME,
  UNIQUE(unit, period_id, pos_our, company)
);

CREATE TABLE IF NOT EXISTS dictionary_companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  segment TEXT,
  region TEXT
);

CREATE TABLE IF NOT EXISTS dictionary_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  pay_from REAL DEFAULT 0, -- оклад Фаровона по должности (эталон для дашборда вилок)
  pay_to REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'открыт', -- 'открыт', 'закрыт'
  from_date TEXT,
  to_date TEXT,
  updated_by TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active INTEGER NOT NULL DEFAULT 0 -- ровно одна строка = 1: текущий период сбора
);

CREATE TABLE IF NOT EXISTS period_edit_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_login TEXT NOT NULL,
  period_id INTEGER NOT NULL REFERENCES periods(id),
  granted_by TEXT NOT NULL,
  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  UNIQUE(user_login, period_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Мультиисточниковый бенчмаркинг вознаграждений (Фаза 1)
-- ============================================================

CREATE TABLE IF NOT EXISTS data_sources (
  key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL, -- 'internal', 'jobsite', 'consultancy'
  is_licensed INTEGER NOT NULL DEFAULT 0,
  default_currency TEXT DEFAULT 'сомони',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS benchmark_datasets (
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
);

CREATE TABLE IF NOT EXISTS source_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  code TEXT,
  label TEXT NOT NULL,
  family TEXT,
  UNIQUE(source_key, label),
  FOREIGN KEY (source_key) REFERENCES data_sources(key)
);

CREATE TABLE IF NOT EXISTS position_map (
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
);

CREATE TABLE IF NOT EXISTS benchmark_rows (
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
);

CREATE TABLE IF NOT EXISTS fx_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  currency TEXT NOT NULL,
  date TEXT NOT NULL,
  rate_to_base REAL NOT NULL, -- курс к сомони (TJS = 1)
  UNIQUE(currency, date)
);

-- Индексы для быстродействия
CREATE INDEX IF NOT EXISTS idx_users_login ON users(login);
CREATE INDEX IF NOT EXISTS idx_divisions_unit ON divisions(unit);
CREATE INDEX IF NOT EXISTS idx_competitors_unit ON competitors(unit);
CREATE INDEX IF NOT EXISTS idx_position_company_selections_unit ON position_company_selections(unit, period_id);
CREATE INDEX IF NOT EXISTS idx_position_company_selections_pos ON position_company_selections(unit, period_id, pos_our);
CREATE INDEX IF NOT EXISTS idx_surveys_unit ON surveys(unit);
CREATE INDEX IF NOT EXISTS idx_surveys_pos ON surveys(pos_our);
CREATE INDEX IF NOT EXISTS idx_benchmark_rows_dataset ON benchmark_rows(dataset_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_rows_pos ON benchmark_rows(source_position_id);
CREATE INDEX IF NOT EXISTS idx_source_positions_source ON source_positions(source_key);
CREATE INDEX IF NOT EXISTS idx_position_map_dict ON position_map(dict_position_id);
CREATE INDEX IF NOT EXISTS idx_position_map_source ON position_map(source_position_id);

