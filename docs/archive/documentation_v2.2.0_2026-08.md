# Техническая документация — «Обзор рынка» (Farovon Market Analysis)
### Версия 2.2.0 | Август 2026 | Конфиденциально

---

## Содержание

1. [Общее описание](#1-общее-описание)
2. [Архитектура системы](#2-архитектура-системы)
3. [Структура проекта](#3-структура-проекта)
4. [Технологический стек](#4-технологический-стек)
5. [Переменные окружения](#5-переменные-окружения)
6. [Схема базы данных](#6-схема-базы-данных)
7. [REST API — полный реестр](#7-rest-api--полный-реестр)
8. [Ролевая модель и Capabilities](#8-ролевая-модель-и-capabilities)
9. [Авторизация и безопасность](#9-авторизация-и-безопасность)
10. [Telegram-интеграция](#10-telegram-интеграция)
11. [Аналитический движок C&B](#11-аналитический-движок-cb)
12. [Миграции базы данных](#12-миграции-базы-данных)
13. [Развёртывание](#13-развёртывание)
14. [CI/CD и pre-deploy проверки](#14-cicd-и-pre-deploy-проверки)
15. [Сервисные инструменты](#15-сервисные-инструменты)
16. [Фронтенд (SPA)](#16-фронтенд-spa)
17. [Мониторинг](#17-мониторинг)
18. [Известные ограничения и Roadmap](#18-известные-ограничения-и-roadmap)
19. [Глоссарий](#19-глоссарий)

---

## 1. Общее описание

**«Обзор рынка»** (`farovon-market-analysis`) — корпоративная full-stack веб-система C&B ГК «Фаровон» для автоматизированного сбора, хранения и аналитической обработки данных о заработных платах, компенсационных пакетах (Net/Gross, фиксированная часть, бонусы, KPI) и льготах (ДМС, питание, связь, ГСМ) компаний-конкурентов.

### Ключевые характеристики

| Параметр | Значение |
|---|---|
| **Версия** | 2.2.0 (Production Release) |
| **Подразделений** | 326 |
| **Пользователей** | 112 активных |
| **Записей штатного расписания** | 1 340 (285 отделов) |
| **Компаний-конкурентов** | 3 631 |
| **API-маршрутов** | 37 |
| **Uptime** | 100% (UptimeRobot) |
| **Репозиторий** | https://github.com/Muzaffarkhon/farovon-market-analysis |
| **Production URL** | https://farovon-market-analysis.onrender.com |

---

## 2. Архитектура системы

```
┌─────────────────────────────────────────────────────────────────────┐
│                        КЛИЕНТСКИЙ УРОВЕНЬ                           │
├────────────────────────────┬────────────────────────────────────────┤
│   Desktop / Mobile SPA     │  Telegram Mini App (iOS/Android/Desktop)│
│   (Apple HIG, Sidebar,     │  (WebApp SDK, Compact Mode,             │
│    Dense Tables, SVG-22)   │   Haptic Feedback, Phone Link)          │
└─────────────┬──────────────┴────────────────────┬───────────────────┘
              │ HTTPS (REST JSON)                 │ Webhook
              ▼                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   СЕРВЕРНЫЙ УРОВЕНЬ  (Node.js / Render.com)         │
├─────────────────────────────────────────────────────────────────────┤
│  Express 4.21 Application Server                                    │
│  ├── Helmet (CSP off for TG SDK) + CORS + Gzip + Morgan            │
│  ├── JWT Auth Middleware  (HMAC-SHA256, 30d, UTF-8)                 │
│  ├── Role-Based Access Control + Capabilities Engine                │
│  ├── Static SPA delivery (public/)  — no-cache headers             │
│  └── Keep-Alive self-ping (/health) каждые 9 мин                   │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ LibSQL Protocol / HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    СЛОЙ ДАННЫХ  (Turso Cloud)                       │
├─────────────────────────────────────────────────────────────────────┤
│  Distributed LibSQL / SQLite  (AWS EU-West-1, Frankfurt)            │
│  ├── @libsql/client 0.17.4                                         │
│  ├── Идемпотентные миграции при старте (src/db/migrate.js)         │
│  ├── bcrypt-хеши паролей, foreign keys, cascade constraints        │
│  └── 9 таблиц + 6 индексов                                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Поток запроса (happy path)

```
Client → HTTPS → Express Router → authMiddleware (JWT verify + DB user fetch)
       → requireCapability (role_capabilities table) → Controller → Service/DB
       → JSON Response → Client
```

---

## 3. Структура проекта

```
farovon-market-analysis/
│
├── src/                          # Серверный код (Node.js)
│   ├── config/
│   │   ├── index.js              # Парсинг .env, missingSecrets()
│   │   └── capabilities.js       # Каталог прав RBAC, роли, дефолты
│   │
│   ├── controllers/              # Бизнес-логика (тонкие обработчики HTTP)
│   │   ├── authController.js     # Вход, сессия, смена пароля, Telegram-привязка
│   │   ├── adminController.js    # Пользователи, оргструктура, период, аудит
│   │   ├── surveyController.js   # Сохранение данных обзора (шаги 1 и 2)
│   │   ├── dashboardController.js# Дашборд C&B, экспорт CSV
│   │   ├── dictionaryController.js# Справочники компаний, должностей, сегментов
│   │   └── telegramController.js # Webhook, привязка/отвязка, рассылка
│   │
│   ├── db/
│   │   ├── database.js           # @libsql/client: queryAll, queryOne, run
│   │   ├── migrate.js            # Идемпотентные ALTER TABLE / CREATE TABLE
│   │   ├── schema.sql            # Базовая схема (первичная инициализация)
│   │   └── seed.js               # Наполнение тестовыми данными (npm run seed)
│   │
│   ├── middleware/
│   │   ├── auth.js               # authMiddleware, requireRoles, requireCapability
│   │   └── errorHandler.js       # Глобальный Express error handler
│   │
│   ├── routes/
│   │   └── api.js                # Все 37 маршрутов с привязкой middleware
│   │
│   ├── services/
│   │   ├── analyticsService.js   # Расчёт перцентилей P25/P50/P75, аналитика
│   │   └── telegramService.js    # Bot API: send, webhook, массовая рассылка
│   │
│   └── tools/                    # DevOps / Admin CLI скрипты (23 файла)
│       ├── auditFrontend.js      # Pre-deploy: JS/CSS/API/SVG аудит
│       ├── deepValidationAudit.js# Глубокая валидация данных БД
│       ├── generateDataBundle.js # Генерация bundle для Turso
│       ├── mergeDuplicateUsers.js# Слияние дублей пользователей (ручное)
│       ├── uploadTargetUsers.js  # Массовая загрузка пользователей
│       └── ...                   # Ещё 18 вспомогательных скриптов
│
├── public/                       # Фронтенд SPA (статика)
│   ├── index.html                # Единый файл SPA (~430 KB, Vanilla JS)
│   └── style.css                 # Дизайн-система Apple HIG (~130 KB)
│
├── data/                         # Исходные CSV/TSV/XLSX справочники
├── docs/                         # Техническая документация (Markdown)
├── Dockerfile                    # node:20-alpine, prod build
├── docker-compose.yml            # Локальный docker-compose
├── package.json                  # npm manifest
├── .env.example                  # Шаблон переменных окружения
└── .gitignore
```

---

## 4. Технологический стек

### Зависимости (production)

| Пакет | Версия | Назначение |
|---|---|---|
| `express` | ^4.21.2 | HTTP-фреймворк, маршрутизация |
| `@libsql/client` | ^0.17.4 | Клиент Turso LibSQL (облачный SQLite) |
| `bcryptjs` | ^2.4.3 | Хеширование паролей (10 раундов) |
| `jsonwebtoken` | ^9.0.2 | JWT-токены (HMAC-SHA256, 30 дней) |
| `node-telegram-bot-api` | ^2.1.0 | Telegram Bot API (webhook-режим) |
| `helmet` | ^8.0.0 | HTTP security headers |
| `cors` | ^2.8.5 | CORS для SPA |
| `compression` | ^1.7.5 | Gzip-сжатие ответов |
| `morgan` | ^1.10.0 | HTTP-логирование |
| `csv-parse` | ^5.6.0 | Парсинг CSV при импорте |
| `dotenv` | ^16.4.7 | Загрузка `.env` файла |

### Runtime требования

| Компонент | Версия |
|---|---|
| Node.js | v20+ (LTS) |
| npm | v10+ |
| Docker | 24+ (опционально) |

---

## 5. Переменные окружения

Файл-шаблон: `.env.example`  
Для локальной разработки создайте `.env` в корне проекта.  
Для Render.com — добавьте в **Dashboard → Environment**.

| Переменная | Обязательна | Описание |
|---|---|---|
| `JWT_SECRET` | **Да** | Секрет подписи JWT. Мин. 32 символа. Генерация: `openssl rand -base64 48` |
| `TURSO_DATABASE_URL` | **Да** | URL облачной базы Turso: `libsql://...turso.io` |
| `TURSO_AUTH_TOKEN` | **Да** | JWT-токен Turso (Turso Dashboard → Connect) |
| `TELEGRAM_BOT_TOKEN` | **Да** | Токен бота от @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | **Да** | Секрет вебхука (случайная строка ≥32 символа) |
| `WEBAPP_URL` | **Да** | Публичный HTTPS URL: `https://farovon-market-analysis.onrender.com` |
| `PORT` | Нет | Порт сервера (default: `3000`) |
| `NODE_ENV` | Нет | `development` / `production` |
| `ADMIN_PASSWORD` | Нет | Только для ручных скриптов (`generateDataBundle.js`), сервер не читает |
| `CB_PASSWORD` | Нет | Только для ручных скриптов |

> **ВАЖНО:** Без `JWT_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` сервер **немедленно завершит работу** (`process.exit(1)`). Резервных значений в коде нет намеренно.

---

## 6. Схема базы данных

База данных: **Turso LibSQL** (SQLite-совместимый, AWS EU-West-1).  
Таблицы создаются через `src/db/schema.sql` при первом запуске и поддерживаются идемпотентно через `src/db/migrate.js`.

### 6.1. `users` — Пользователи системы

```sql
CREATE TABLE IF NOT EXISTS users (
  id                INTEGER  PRIMARY KEY AUTOINCREMENT,
  login             TEXT     UNIQUE NOT NULL,           -- транслит ФИО, регистр игнорируется
  password_hash     TEXT     NOT NULL,                  -- bcrypt $2a$ или $2b$
  fio               TEXT     NOT NULL,                  -- Полное ФИО
  role              TEXT     NOT NULL DEFAULT 'user',   -- admin|cb|dir_head|hrbp|head|user
  phone             TEXT     DEFAULT '',
  units             TEXT     DEFAULT '',                -- подразделения через ';'
  active            INTEGER  NOT NULL DEFAULT 1,        -- 1=активен, 0=заблокирован
  telegram_chat_id  TEXT     DEFAULT '',
  telegram_username TEXT     DEFAULT '',
  last_login_at     DATETIME,
  archived_at       DATETIME,                           -- NULL = активен/заблокирован
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Правила:**
- `admin` защищён: нельзя установить `active=0` или `archived_at IS NOT NULL` программно
- Пароль никогда не хранится в открытом виде (`raw_password` колонка удалена в PR #2)
- `units` — список подразделений через `;`, например: `Отдел HR;Отдел финансов`

### 6.2. `divisions` — Оргструктура (326 подразделений)

```sql
CREATE TABLE IF NOT EXISTS divisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  num             INTEGER,
  unit            TEXT    UNIQUE NOT NULL,             -- название подразделения (уникально)
  dir             TEXT    NOT NULL DEFAULT '',         -- направление / дирекция (Уровень 2)
  head            TEXT    DEFAULT '',                  -- руководитель направления
  resp            TEXT    DEFAULT '',                  -- ответственный за обзор
  hrbp            TEXT    DEFAULT '',                  -- HR Business Partner
  note            TEXT    DEFAULT '',
  code            TEXT,                                -- код подразделения (мигрирован)
  group_key       TEXT,                                -- ключ смежной группы (мигрирован)
  parent_unit     TEXT    DEFAULT NULL,                -- родительский отдел (Уровень 4, мигрирован)
  org_role        TEXT    DEFAULT 'line',              -- line|governance|control (мигрирован)
  is_survey_target INTEGER DEFAULT 1,                 -- участвует в обзоре (мигрирован)
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- Индексы:
CREATE INDEX IF NOT EXISTS idx_divisions_dir ON divisions(dir);
CREATE INDEX IF NOT EXISTS idx_divisions_org_role ON divisions(org_role);
```

### 6.3. `competitors` — Участники рынка

```sql
CREATE TABLE IF NOT EXISTS competitors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  unit        TEXT    NOT NULL,
  company     TEXT    NOT NULL,
  segment     TEXT    DEFAULT '',
  region      TEXT    DEFAULT '',
  source_type TEXT    DEFAULT '',
  actual      TEXT    DEFAULT 'не проверено',    -- актуально|не актуально|уточнить|стоп-лист
  comment     TEXT    DEFAULT '',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(unit, company)
);
CREATE INDEX IF NOT EXISTS idx_competitors_unit_actual ON competitors(unit, actual);
```

### 6.4. `unit_positions` — Штатное расписание

```sql
CREATE TABLE IF NOT EXISTS unit_positions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  unit        TEXT    NOT NULL,
  position    TEXT    NOT NULL,
  staff_count INTEGER DEFAULT 0,
  UNIQUE(unit, position)
);
CREATE INDEX IF NOT EXISTS idx_unit_positions_unit ON unit_positions(unit);
```

### 6.5. `surveys` — Зарплатные анкеты

```sql
CREATE TABLE IF NOT EXISTS surveys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  unit          TEXT    NOT NULL,
  company       TEXT    NOT NULL,
  pos_our       TEXT    NOT NULL,               -- штатная должность
  pay_from      REAL    DEFAULT 0,              -- оклад «от»
  pay_to        REAL    DEFAULT 0,              -- оклад «до»
  cur           TEXT    DEFAULT 'сомони',       -- валюта
  pay_per       TEXT    DEFAULT 'в месяц',      -- периодичность
  tax_type      TEXT    DEFAULT 'Net',          -- Net|Gross
  bon_has       TEXT    DEFAULT '',             -- да|нет
  bon_size      TEXT    DEFAULT '',             -- % бонуса
  bon_type      TEXT    DEFAULT '',             -- тип бонуса (KPI, ежемесячный...)
  bon_per       TEXT    DEFAULT '',             -- периодичность бонуса
  benefits      TEXT    DEFAULT '',             -- льготы через ';'
  note          TEXT    DEFAULT '',
  state         TEXT    DEFAULT 'активна',      -- активна|удалена
  author_login  TEXT    NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(unit, company, pos_our)
);
CREATE INDEX IF NOT EXISTS idx_surveys_unit_state ON surveys(unit, state);
```

### 6.6. `dictionary_companies` — Справочник компаний

```sql
CREATE TABLE IF NOT EXISTS dictionary_companies (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT    UNIQUE NOT NULL,
  segment TEXT    DEFAULT '',
  region  TEXT    DEFAULT '',
  code    TEXT,
  dirs    TEXT    DEFAULT ''     -- направления через ';' (мигрировано)
);
CREATE INDEX IF NOT EXISTS idx_dict_companies_name ON dictionary_companies(name);
```

### 6.7. `dictionary_positions` — Справочник должностей

```sql
CREATE TABLE IF NOT EXISTS dictionary_positions (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT UNIQUE NOT NULL,
  category TEXT    DEFAULT '',
  code     TEXT,
  dirs     TEXT    DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_dict_positions_name ON dictionary_positions(name);
```

### 6.8. `dictionary_segments` / `dictionary_regions`

```sql
CREATE TABLE IF NOT EXISTS dictionary_segments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS dictionary_regions  (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
```

### 6.9. `periods` — Периоды сбора данных

```sql
CREATE TABLE IF NOT EXISTS periods (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  state       TEXT    DEFAULT 'открыт',       -- открыт|закрыт
  from_date   DATE,
  to_date     DATE,
  updated_by  TEXT,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 6.10. `role_capabilities` — Матрица прав RBAC

```sql
CREATE TABLE IF NOT EXISTS role_capabilities (
  role        TEXT NOT NULL,
  capability  TEXT NOT NULL,
  PRIMARY KEY (role, capability)
);
```

### 6.11. `audit_log` — Журнал аудита

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  login      TEXT    NOT NULL,
  action     TEXT    NOT NULL,
  detail     TEXT    DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 7. REST API — полный реестр

**Базовый URL:** `/api`  
**Авторизация:** `Authorization: Bearer <JWT>` или `X-Token: <JWT>` (все маршруты, кроме `/auth/login` и `/telegram/webhook`)  
**Формат ответа:** `{ ok: true, ... }` или `{ ok: false, error: "CODE", message: "..." }`

---

### 7.1. Аутентификация (`/api/auth`)

#### `POST /api/auth/login`
Вход по логину и паролю.

**Body:**
```json
{ "login": "admin", "password": "mypassword" }
```

**Response 200:**
```json
{
  "ok": true,
  "token": "eyJ...",
  "user": {
    "id": 1,
    "login": "admin",
    "fio": "Администратор",
    "role": "admin",
    "phone": "",
    "units": [],
    "capabilities": ["divisions:view", "divisions:edit", ...]
  },
  "period": { "name": "Обзор рынка Q3", "state": "открыт" },
  "allUnits": [...],
  "competitors": [...],
  "surveys": [...]
}
```

**Ошибки:** `401 USER_NOT_FOUND`, `403 USER_BLOCKED`, `401 WRONG_PASSWORD`

---

#### `GET /api/auth/resume`
Восстановление сессии по действующему токену.

**Headers:** `Authorization: Bearer <JWT>`  
**Response 200:** Аналогично `/login` (полный payload без повторного ввода пароля)

---

#### `POST /api/auth/change-password`
Смена пароля текущего пользователя.

**Body:**
```json
{ "currentPassword": "old", "newPassword": "new123" }
```

---

#### `POST /api/auth/set-units`
Обновление списка закреплённых подразделений пользователя.

**Body:** `{ "units": ["Отдел HR", "Отдел финансов"] }`

---

### 7.2. Опрос и данные (`/api/survey`)

#### `POST /api/survey/save`
Шаг 1 — сохранение актуальности конкурентов по подразделению.

**Body:**
```json
{
  "unit": "Отдел охраны Анхор",
  "companies": [
    { "company": "Alpha Security", "actual": "актуально", "comment": "..." },
    { "company": "Beta Guard", "actual": "не актуально", "comment": "" }
  ]
}
```

---

#### `POST /api/survey/save-details`
Шаг 2 — сохранение зарплатной анкеты.

**Body:**
```json
{
  "unit": "Отдел охраны Анхор",
  "company": "Alpha Security",
  "position": "Охранник",
  "payFrom": 2500000,
  "payTo": 3500000,
  "cur": "сомони",
  "taxType": "Net",
  "bonHas": "да",
  "bonSize": "15",
  "bonType": "KPI",
  "bonPer": "ежемесячный",
  "benefits": ["питание", "связь"],
  "note": "Данные от рекрутера"
}
```

**Валидация:**
- `payFrom <= payTo` — если нарушено, возвращает `400`
- Оба поля оклада могут быть `0` (данные не заполнены)

---

#### `POST /api/survey/dictionary/add`
Добавление новой компании или должности в справочник прямо из формы.

**Body:** `{ "type": "company"|"position", "name": "Новая компания" }`

---

### 7.3. Дашборд C&B (`/api/dashboard`)

#### `POST /api/dashboard/extended`
Полная расширенная аналитика.  
Требует: `dashboard:view`

**Body (фильтры):**
```json
{ "dir": "Департамент безопасности", "hrbp": "Иванова А.А.", "search": "охранник" }
```

**Response:**
```json
{
  "ok": true,
  "summary": {
    "totalDivisions": 326,
    "completedDivisions": 180,
    "divCompletionPct": 55,
    "totalSurveyRecords": 2400,
    "positionsCount": 89
  },
  "positions": [
    {
      "pos": "Охранник",
      "count": 42,
      "withSalaryCount": 38,
      "min": 2000000, "p25": 2400000, "median": 2800000, "p75": 3200000, "max": 4000000,
      "forkSpreadPct": 100,
      "companies": [...]
    }
  ],
  "hrbpProgress": [...],
  "dirProgress": [...],
  "topBenefits": [...],
  "bonuses": { "hasBonus": 120, "noBonus": 80, "types": {...}, "periods": {...} },
  "topCompetitors": [...],
  "period": { "name": "Q3 2026", "state": "открыт" }
}
```

---

#### `POST /api/dashboard/hrbp`
Прогресс заполнения по HR BP и Дирекциям.  
Требует: `dashboard:view`

---

#### `GET /api/dashboard/export-csv`
Экспорт всех данных в CSV (UTF-8 BOM, корректно в Excel).  
Требует: `dashboard:view`

**Headers response:**
```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="obzor_rynka_export.csv"
```

---

### 7.4. Панель Администратора (`/api/admin`)

#### `GET /api/admin/users`
Список всех активных пользователей.  
Требует: `users:view`

#### `POST /api/admin/users`
Создание или редактирование пользователя.  
Требует: `users:create` **или** `users:edit`

**Body:**
```json
{
  "login": "ivanova.a",
  "fio": "Иванова Алина Аслановна",
  "role": "hrbp",
  "phone": "+992901234567",
  "units": ["Отдел HR", "Бухгалтерия"],
  "password": "newpass123",       // только при создании
  "active": 1
}
```

#### `POST /api/admin/users/:login/toggle`
Блокировка / разблокировка пользователя.  
Требует: `users:edit`  
**Запрещено** для учётной записи `admin`.

#### `POST /api/admin/users/:login/reset-password`
Сброс пароля пользователя администратором.  
Требует: `users:edit`

**Body:** `{ "newPassword": "temp123" }`

#### `GET /api/admin/users-archive`
Список архивированных (мягко удалённых) пользователей.  
Требует: `users:view`

#### `POST /api/admin/users/:login/archive`
Перевод в архив (soft delete: устанавливает `archived_at = NOW()`).  
Требует: `users:edit`  
**Запрещено** для `admin` и текущего залогиненного пользователя.

#### `POST /api/admin/users/:login/restore`
Восстановление из архива.  
Требует: `users:edit`

---

#### `GET /api/admin/divisions`
Список всех 326 подразделений с ответственными и группами.  
Требует: `divisions:view`

#### `POST /api/admin/divisions`
Обновление данных подразделения.  
Требует: `divisions:edit`

**Body:**
```json
{
  "unit": "Отдел охраны Анхор",
  "head": "Петров И.И.",
  "resp": "Сидоров А.А.",
  "hrbp": "Иванова А.А.",
  "note": "смежная группа: охрана",
  "group_key": "Служба охраны"
}
```

**Ограничение для `dir_head`:** может обновлять только подразделения своего направления (`dir`).

#### `POST /api/admin/divisions/move`
Перемещение подразделения в другое направление (Drag-and-Drop).  
Требует: `divisions:edit`

**Body:** `{ "unit": "...", "targetDir": "...", "cascadeCompetitors": true }`

#### `POST /api/admin/divisions/batch-assign`
Массовое назначение ответственных по направлению.  
Требует: `divisions:edit`

---

#### `GET /api/admin/dictionary/:kind`
Получение справочника.  
Требует: `dictionary:view`  
`:kind` = `companies` | `positions` | `segments` | `regions` | `benefits`

#### `POST /api/admin/dictionary/:kind`
Добавление / обновление элемента справочника.  
Требует: `dictionary:create` **или** `dictionary:edit`

#### `POST /api/admin/dictionary/:kind/delete`
Удаление элемента (при отсутствии ссылок на него).  
Требует: `dictionary:edit`

#### `GET /api/admin/dictionary/:kind/usage`
Количество использований элемента (перед удалением).  
Требует: `dictionary:edit`

---

#### `POST /api/admin/period`
Создание / переключение периода сбора.  
Требует: `period:edit`

**Body:** `{ "name": "Q3 2026", "state": "открыт", "fromDate": "2026-09-01", "toDate": "2026-09-30" }`

---

#### `POST /api/admin/maintenance`
Запуск сервисных утилит.  
Требует: `service:edit`

**Body:** `{ "action": "clean-segments" | "fix-links" | "import-staffing" | "distribute-companies" | "undo-distribute" }`

---

#### `GET /api/admin/audit-log`
Журнал действий пользователей.  
Требует: `service:view`

**Query params:** `?login=admin&action=reset&limit=100&offset=0`

#### `GET /api/admin/data-status`
Сводка по состоянию данных в БД.  
Требует: `service:view`

---

#### `GET /api/admin/role-capabilities`
Текущая матрица прав по ролям.  
Требует: только `admin` (жёсткая роль, не через capabilities)

#### `POST /api/admin/role-capabilities`
Обновление матрицы прав.  
Требует: только `admin`

**Body:** `{ "cb": ["dashboard:view", "divisions:view"], "hrbp": ["dashboard:view"] }`

---

### 7.5. Telegram (`/api/telegram`)

#### `POST /api/telegram/webhook`
Входящие сообщения от Telegram. **Без JWT**.  
Проверяется `X-Telegram-Bot-Api-Secret-Token` заголовок.

Обрабатываемые типы обновлений:
- `message.text`: команды `/start`, `/login`, `/status`, `/unlink`, `/link`, `/help`
- `message.contact`: регистрация по номеру телефона
- `callback_query`: ответ на inline-кнопки

#### `POST /api/telegram/link`
Генерация токена для привязки Telegram-аккаунта.  
Требует JWT.

#### `POST /api/telegram/unlink`
Отвязка Telegram от текущей учётной записи.  
Требует JWT.

---

### 7.6. Системный мониторинг

#### `GET /health`
Проверка состояния сервера. **Публичный** (без JWT).

**Response:**
```json
{
  "ok": true,
  "db": "ok",
  "version": "2.2.0",
  "timestamp": "2026-08-30T01:00:00.000Z",
  "env": "production",
  "lastUptimeRobotPing": "2026-08-30T00:55:00.000Z"
}
```

---

## 8. Ролевая модель и Capabilities

### 8.1. Роли пользователей

Роль хранится в `users.role` и является неизменяемым идентификатором бизнес-функции:

| Роль | Системное название | Назначение |
|---|---|---|
| Главный администратор | `admin` | Полные права, защищённая роль |
| C&B Аналитик | `cb` | Аналитика и администрирование |
| Руководитель направления | `dir_head` | Назначение ответственных в своём направлении |
| HR Business Partner | `hrbp` | Мониторинг и рассылки напоминаний |
| Руководитель отдела | `head` | Ввод данных (legacy, идентичен `user`) |
| Сотрудник / Ответственный | `user` | Ввод данных по своим подразделениям |

### 8.2. Матрица Capabilities (дефолтные значения)

Права хранятся в таблице `role_capabilities` и управляются через раздел **«Роли и доступы»** в интерфейсе.

| Capability | Ресурс | `cb` | `hrbp` | `dir_head` | `head` | `user` |
|---|---|:---:|:---:|:---:|:---:|:---:|
| `divisions:view` | Оргструктура | ✅ | ✅ | ✅ | | |
| `divisions:edit` | Оргструктура | ✅ | | ✅ | | |
| `users:view` | Пользователи | ✅ | | ✅ | | |
| `users:create` | Пользователи | ✅ | | | | |
| `users:edit` | Пользователи | ✅ | | | | |
| `dictionary:view` | Справочники | ✅ | ✅ | | | |
| `dictionary:create` | Справочники | ✅ | | | | |
| `dictionary:edit` | Справочники | ✅ | | | | |
| `period:view` | Период сбора | ✅ | ✅ | | | |
| `period:edit` | Период сбора | ✅ | ✅ | | | |
| `service:view` | Журнал / Сервис | ✅ | | | | |
| `service:edit` | Сервисные задачи | ✅ | | | | |
| `dashboard:view` | Дашборд C&B | ✅ | ✅ | | | |

**Особые правила:**
- `admin` всегда имеет все права **без обращения к таблице** (жёсткая защита в `auth.js`)
- `admin` нельзя удалить из таблицы `role_capabilities` и добавить туда — ошибка

---

## 9. Авторизация и безопасность

### 9.1. Схема JWT

```javascript
// Payload токена:
{ id, login, role, fio }
// Алгоритм: HMAC-SHA256
// Срок жизни: 30 дней (configurable через JWT_EXPIRES_IN)
// Передача: Authorization: Bearer <token>  ИЛИ  X-Token: <token>  ИЛИ ?token=<token>
```

### 9.2. Хеширование паролей

```javascript
bcrypt.hashSync(password, 10)   // при сохранении
bcrypt.compareSync(pwd, hash)   // при проверке
```

Обратная совместимость: если хеш начинается не с `$2a$/$2b$/$2y$`, проверяется SHA-256 (legacy миграция).

### 9.3. Защита учётной записи admin

Следующие операции над `admin` **заблокированы на уровне API**:

- `toggleUser` → `403` если `login === 'admin'`
- `archiveUser` → `403` если `login === 'admin'`
- `saveUser` → запрет смены роли `admin` на другую
- Текущий пользователь не может заблокировать себя

### 9.4. Audit Log

Все критические действия автоматически записываются в `audit_log`:

| Событие | Поле `action` |
|---|---|
| Вход в систему | `login` |
| Сброс пароля | `reset_password` |
| Архивация пользователя | `archive_user` |
| Восстановление пользователя | `restore_user` |
| Назначение ответственного | `assign_resp` |
| Открытие/закрытие периода | `set_period` |
| Раздача пула компаний | `distribute_companies` |
| Откат раздачи | `undo_distribute` |
| Telegram-привязка/отвязка | `telegram_link` / `telegram_unlink` |

### 9.5. Безопасность Webhook Telegram

```javascript
// Заголовок: X-Telegram-Bot-Api-Secret-Token
// Проверяется против TELEGRAM_WEBHOOK_SECRET из .env
// При несовпадении: 403 Forbidden
```

---

## 10. Telegram-интеграция

### 10.1. Архитектура

```
Telegram Server
      │  HTTPS POST (обновления)
      ▼
/api/telegram/webhook  (без JWT, проверка secret_token)
      │
      ▼
telegramController.js  →  telegramService.js (Bot API)
                       →  authController.js  (привязка)
                       →  analyticsService.js (статус)
```

### 10.2. Команды бота

| Команда | Описание | Ответ бота |
|---|---|---|
| `/start` | Привязать Telegram к аккаунту | Кнопка «Поделиться номером телефона» |
| `/login` | Получить логин и ссылку на систему | Логин + URL |
| `/status` | Прогресс заполнения своих подразделений | Список незаполненных подразделений |
| `/unlink` | Отвязать аккаунт | Подтверждение отвязки |
| `/link` | Привязать по номеру телефона | Кнопка контакта |
| `/help` | Список команд | Справка |

### 10.3. Привязка аккаунта (диплинк)

```
1. Пользователь в браузере: Профиль → «Привязать Telegram»
2. API: POST /api/telegram/link → { token: "abc123" }
3. Диплинк: https://t.me/<botusername>?start=abc123
4. Пользователь переходит в Telegram, бот получает /start abc123
5. Bot: проверяет token → находит пользователя → записывает telegram_chat_id
```

### 10.4. Привязка по номеру телефона

```
/start → бот просит: «Поделитесь контактом»
→ message.contact → phone normalization → users WHERE phone = ?
→ telegram_chat_id записывается
```

### 10.5. Массовая рассылка напоминаний

```javascript
// src/services/telegramService.js :: sendMassReminder()
// 1. Запрашивает все незаполненные подразделения (totalComp = 0 ИЛИ done < total)
// 2. Сопоставляет с пользователями по (units, resp, head)
// 3. Если telegram_chat_id задан — отправляет персонализированное сообщение
// 4. Возвращает: { ok: true, sent: N, uncompletedCount: M }
```

**Антифлуд:** вызывается только через кнопку в интерфейсе; rate limit на стороне Telegram Bot API (25 msg/s).

---

## 11. Аналитический движок C&B

### 11.1. Алгоритм расчёта перцентилей

```javascript
// src/services/analyticsService.js :: calculateSalaryForkStats()

function calculateSalaryForkStats(fromSamples, toSamples, midSamples) {
  // midSamples = среднее (from + to) / 2 для каждой анкеты
  const n = midSamples.length;
  if (n === 0) return { min: 0, p25: 0, median: 0, p75: 0, max: 0, avg: 0, spread: 0 };

  // Рыночные границы — по реальным «от» и «до»
  const min = Math.min(...validFroms);
  const max = Math.max(...validTos);

  // Линейная интерполяция (C&B стандарт)
  const sorted = [...midSamples].sort((a, b) => a - b);
  const percentile = (p) => {
    const i = (n - 1) * p;
    const l = Math.floor(i);
    return Math.round(sorted[l] + (sorted[Math.min(l+1, n-1)] - sorted[l]) * (i - l));
  };

  const median = percentile(0.5);   // P50
  const p25    = percentile(0.25);  // P25
  const p75    = percentile(0.75);  // P75

  // Размах вилки (%): защита от деления на ноль
  const spread = (min > 0 && max > min) ? Math.round(((max - min) / min) * 100) : 0;

  return { min, p25, median, p75, max, avg, spread };
}
```

**Важные правила C&B:**
- Защита от деления на ноль во всех формулах
- Защита от `NaN` при пустых выборках
- Валидация `salary_min <= salary_max` на уровне API (`surveyController.js`)

### 11.2. Параллельный запрос данных

Аналитика запрашивает все три таблицы (`divisions`, `competitors`, `surveys`) за **один сетевой раунд** (`Promise.all`) для минимальной задержки.

### 11.3. Фильтрация в аналитике

- По направлению (`dir`): фильтрует `unitMap` по полю `div.dir`
- По HR BP (`hrbp`): фильтрует по `div.hrbp`
- По должности (`search`): строковый поиск `posOur.includes(search)`
- Все фильтры можно комбинировать

---

## 12. Миграции базы данных

Файл: `src/db/migrate.js`  
Запускается **автоматически при каждом старте сервера** (IIFE в `server.js`).

### Принципы

- Все операции **идемпотентны**: повторный запуск безопасен
- `ALTER TABLE ... ADD COLUMN` выполняется только если колонки нет (`ensureColumn()`)
- `CREATE TABLE IF NOT EXISTS` — стандартный шаблон
- `INSERT OR IGNORE` — для справочников (не перезаписывает удалённые данные)

### Что добавляется через миграции (сверх базовой схемы)

| Таблица | Колонка / Индекс | Описание |
|---|---|---|
| `dictionary_companies` | `dirs TEXT` | Привязка компаний к направлениям |
| `dictionary_positions` | `dirs TEXT` | Привязка должностей к направлениям |
| `divisions` | `code TEXT` | Код подразделения |
| `divisions` | `group_key TEXT` | Ключ смежной группы |
| `divisions` | `parent_unit TEXT` | Родительский отдел (Уровень 4) |
| `divisions` | `org_role TEXT` | Корпоративная роль (`line/governance/control`) |
| `divisions` | `is_survey_target INT` | Участвует ли в обзоре |
| `dictionary_companies` | `code TEXT` | Код компании |
| `dictionary_positions` | `code TEXT` | Код должности |
| — | `unit_positions` | Штатное расписание |
| — | `dictionary_segments` | Справочник сегментов |
| — | `dictionary_regions` | Справочник регионов |
| — | `role_capabilities` | Матрица прав RBAC |
| — | 6 индексов | Ускорение выборок |

---

## 13. Развёртывание

### 13.1. Локальный запуск

```bash
# 1. Клонировать репозиторий
git clone https://github.com/Muzaffarkhon/farovon-market-analysis.git
cd farovon-market-analysis

# 2. Установить зависимости
npm ci

# 3. Создать .env (по шаблону)
copy .env.example .env
# Заполните JWT_SECRET, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, TELEGRAM_BOT_TOKEN

# 4. Pre-deploy проверки
node --check src/server.js
node src/tools/auditFrontend.js

# 5. Запустить в режиме разработки (автоперезапуск при изменениях)
npm run dev

# Или в продакшн-режиме:
npm start
```

Сервер: `http://localhost:3000`

### 13.2. Docker

```bash
# Сборка и запуск
docker-compose up -d --build

# Просмотр логов
docker-compose logs -f

# Остановка
docker-compose down
```

`Dockerfile` (`node:20-alpine`):
- Устанавливает `python3 make g++` (нативные зависимости SQLite)
- `npm ci --only=production`
- `EXPOSE 3000`
- `CMD ["node", "src/server.js"]`

### 13.3. Render.com (Production)

**Тип:** Web Service  
**Branch:** `main`  
**Build Command:** `npm ci`  
**Start Command:** `npm start`  
**Auto-Deploy:** При каждом push в `main`  
**Region:** Frankfurt (EU-West)

**Настройки Render → Environment:**
- Добавить все обязательные переменные из раздела 5
- `NODE_ENV=production`

### 13.4. Turso Cloud

**Кластер:** `farovon-market-analysis-muzaffarkhon`  
**Region:** AWS EU-West-1 (Frankfurt)  
**Протокол:** LibSQL over HTTPS

Получить credentials:
```bash
turso db show farovon-market-analysis
turso db tokens create farovon-market-analysis
```

### 13.5. Telegram Webhook

Webhook регистрируется **автоматически при старте сервера** через `ensureWebhook()`.

Условия регистрации:
- `TELEGRAM_BOT_TOKEN` задан
- `WEBAPP_URL` не содержит `localhost`
- `TELEGRAM_WEBHOOK_SECRET` задан

Ручная проверка:
```bash
curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo
```

---

## 14. CI/CD и pre-deploy проверки

### Pre-deploy gate (выполнить перед каждым коммитом)

```powershell
# 1. Синтаксис серверного кода
node --check src/server.js
node --check src/db/migrate.js
node --check src/config/capabilities.js

# 2. Аудит фронтенда (auditFrontend.js проверяет):
#    - Синтаксис JavaScript в index.html
#    - Все CSS-классы описаны в style.css
#    - Каждый call(api) имеет зарегистрированный маршрут в Express (37 шт.)
#    - Все 22 SVG-иконки существуют
node src/tools/auditFrontend.js
```

**Статус «НЕ ГОТОВО»** если любая команда вернула ненулевой exit code.

### GitHub → Render Auto-Deploy

```
git commit -m "feat/..."
git push origin main
         ↓
Render обнаруживает push → запускает npm ci → npm start
         ↓
server.js: missingSecrets() → migrate() → ensureWebhook()
         ↓
Сервер готов, UptimeRobot пингует /health
```

---

## 15. Сервисные инструменты

Все инструменты находятся в `src/tools/`. Запускаются вручную с указанием Turso credentials в `.env`.

| Скрипт | Назначение |
|---|---|
| `auditFrontend.js` | **Pre-deploy:** JS/CSS/API/SVG аудит (запускать всегда) |
| `deepValidationAudit.js` | Глубокая валидация данных: орфография, дубли, несвязанные записи |
| `generateDataBundle.js` | Генерация bundle пользователей/подразделений для Turso |
| `uploadTargetUsers.js` | Массовая загрузка 112 пользователей с паролями |
| `mergeDuplicateUsers.js` | Слияние дублей пользователей (только вручную!) |
| `enrichFullFio.js` | Дополнение отчеств из внешнего источника |
| `syncDivisionsBatch.js` | Batch-синхронизация 326 подразделений |
| `checkDivisionsMatch.js` | Проверка соответствия оргструктуры |
| `checkHrbpDistribution.js` | Проверка распределения HR BP |
| `dumpTursoBundle.js` | Дамп всех данных из Turso в JSON |
| `cleanTurso.js` | Очистка тестовых/дублирующихся данных (опасно!) |
| `restoreWrongMerges.js` | Откат ошибочных слияний пользователей |
| `syncCsvPasswords.js` | Синхронизация паролей из CSV |
| `verifyLiveLogins.js` | Проверка работоспособности всех логинов |
| `testAdminEndpoints.js` | Тест admin API-эндпоинтов |
| `testServerEndToEnd.js` | E2E тест потоков авторизации |
| `testTelegramLogin.js` | Тест Telegram webhook |
| `testTursoClient.js` | Проверка соединения с Turso |

---

## 16. Фронтенд (SPA)

### Файлы

| Файл | Размер | Описание |
|---|---|---|
| `public/index.html` | ~430 KB | Вся SPA-логика (Vanilla JS, без фреймворков) |
| `public/style.css` | ~130 KB | Дизайн-система Apple HIG + адаптивность |

### Технические требования

- **Vanilla JS** — никакого React, Vue, Angular, Bundler'ов
- **Vanilla CSS** — без Tailwind, SCSS, CSS-in-JS
- Один HTML-файл + один CSS-файл
- Состояние хранится в глобальном объекте `S`

### Ключевые функции фронтенда

| Функция | Назначение |
|---|---|
| `renderAdminDivisions()` | Рендер оргструктуры (дерево / таблица) |
| `alignOrgBranches()` | Выравнивание стрелок между уровнями |
| `confirmMoveDivision()` | Диалог перемещения (Drag-and-Drop) |
| `promptAssignStaffToDir()` | Назначение сотрудника на направление |
| `promptAssignStaffToUnit()` | Назначение сотрудника на отдел |
| `renderCBDashboard()` | Рендер аналитического дашборда |
| `renderAdminUsers()` | Таблица пользователей |

### Глобальный объект состояния `S`

```javascript
S = {
  user: { login, fio, role, units, capabilities },
  token: "JWT...",
  allUnits: [...],          // все подразделения
  adminDivs: [...],         // оргструктура для таблицы
  expandedDir: "...",       // раскрытое направление
  expandedUnit: "...",      // выбранный отдел
  selectedOrgNode: null,    // { type: 'dir'|'unit', name }
  adminDivsView: 'tree',    // 'tree' | 'table'
  period: { name, state }
}
```

### Компактный режим (Telegram)

При обнаружении `window.Telegram?.WebApp` или узкого viewport добавляется класс `html.compact`:
- Уменьшенные отступы, убирается sidebar
- Мобильный таб-бар внизу
- Tap targets ≥ 44px

### Кэширование

Сервер отдаёт `Cache-Control: no-cache` для HTML/CSS/JS, чтобы обновления деплоились мгновенно без хард-рефреша.

---

## 17. Мониторинг

### UptimeRobot

- Мониторит `GET /health` каждые **5 минут**
- При недоступности: email-alert + публичный статус
- `lastUptimeRobotPing` в ответе `/health` — отметка последнего пинга

### Keep-Alive (предотвращение засыпания Render Free Tier)

```javascript
// server.js — только в production
setInterval(() => {
  http.get(`http://127.0.0.1:${port}/health`)
}, 9 * 60 * 1000).unref();  // каждые 9 минут
```

### Логирование

- **Morgan** (`dev` format): все HTTP-запросы с методом, URL, статусом, временем
- **console.log/warn/error**: миграции, Telegram webhook, health check ошибки
- Логи доступны в Render Dashboard → Logs (real-time)

---

## 18. Известные ограничения и Roadmap

### Текущие ограничения

| Ограничение | Статус | Описание |
|---|---|---|
| 4-уровневая иерархия | 🔴 В разработке | `parent_unit` мигрировано, frontend/backend не обновлены |
| Drag-and-Drop Уровень 4 | 🔴 В разработке | Перетаскивание подотделов |
| «Транспортный отдел Г1» | 🔴 Требует исправления | Некорректно перемещён в Drag-and-Drop |

### Roadmap

| Приоритет | Функция | Оценка |
|---|---|---|
| 🔴 Высокий | Добавить `parent_unit` в `migrate.js` → обновить backend → frontend | 2–3 дня |
| 🔴 Высокий | Исправить «Транспортный отдел Г1» в данных | 30 мин |
| 🟡 Средний | Telegram Push-notifications (7.0+) | 2–3 дня |
| 🟡 Средний | PDF-экспорт аналитических отчётов | 3–5 дней |
| 🟢 Перспектива | AI-ассистент подбора вилок (LLM) | TBD |

---

## 19. Глоссарий

| Термин | Определение |
|---|---|
| **C&B** | Compensation & Benefits — компенсации и льготы |
| **P25 / P50 / P75** | 25-й / 50-й / 75-й перцентиль распределения зарплат |
| **Вилка** | Диапазон оклада `from` (минимум) — `to` (максимум) |
| **Net** | Зарплата на руки (после вычета налогов) |
| **Gross** | Зарплата до вычета налогов (начисление) |
| **Spread %** | Размах вилки: `((max - min) / min) × 100%` |
| **Soft Delete** | Мягкое удаление: `archived_at = NOW()`, данные не стираются физически |
| **JWT** | JSON Web Token — подписанный токен авторизации |
| **RBAC** | Role-Based Access Control — управление доступом на основе ролей |
| **Capability** | Гранулярное право доступа к разделу системы |
| **group_key** | Ключ смежной группы — объединение однотипных площадок |
| **dir** | Направление / Дирекция — Уровень 2 оргструктуры |
| **unit** | Подразделение / Отдел — Уровень 3 оргструктуры |
| **parent_unit** | Родительский отдел — Уровень 4 (в разработке) |
| **Turso** | Облачный распределённый SQLite-совместимый движок (LibSQL) |
| **SPA** | Single-Page Application — одностраничное приложение |
| **Webhook** | Endpoint для получения push-уведомлений от Telegram |
| **Idempotent** | Операция, безопасная при повторном выполнении |
| **auditFrontend.js** | Pre-deploy скрипт: проверяет JS, CSS, API-маршруты, SVG |
| **UptimeRobot** | Внешний сервис мониторинга доступности |
| **Render.com** | Облачный PaaS-хостинг (аналог Heroku) |

---

*Документ подготовлен на основе кодовой базы `farovon-market-analysis v2.2.0`*  
*Последнее обновление: 30 августа 2026 г.*  
*Конфиденциально — внутренняя разработка C&B ГК «Фаровон»*
