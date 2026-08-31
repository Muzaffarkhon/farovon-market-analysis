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
  benefits TEXT DEFAULT '',
  schedule TEXT DEFAULT '',
  extra TEXT,
  source TEXT,
  trust TEXT,
  note TEXT,
  created_by TEXT,
  created_at DATETIME,
  state TEXT DEFAULT 'активна',
  period TEXT
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
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для быстродействия
CREATE INDEX IF NOT EXISTS idx_users_login ON users(login);
CREATE INDEX IF NOT EXISTS idx_divisions_unit ON divisions(unit);
CREATE INDEX IF NOT EXISTS idx_competitors_unit ON competitors(unit);
CREATE INDEX IF NOT EXISTS idx_surveys_unit ON surveys(unit);
CREATE INDEX IF NOT EXISTS idx_surveys_pos ON surveys(pos_our);
