# Security review — «Обзор рынка» / Farovon Market Analysis

**Дата:** 2026-08-31
**Коммит:** `fadd7f7` (ветка `main`)
**Область:** аудит по коду `src/` (backend Node/Express + Turso LibSQL + Telegram-бот). Фронтенд `public/index.html` — только беглый осмотр, отдельный проход по XSS не делался.

Легенда статуса: ⬜ не начато · 🟡 в работе · ✅ сделано · ⏭️ требует действия вне репозитория (Render / Turso / BotFather)

## Реализовано в ветке `security/review-2026-08-31`

| Пункт | Что сделано |
|---|---|
| P0-2 | Гард эскалации в `saveUser`: не-admin не может назначить роль `admin` и не может править учётку с `role='admin'` (`adminController.js`) |
| P0-3 | `express-rate-limit` (v7): `apiLimiter` на весь `/api`, строгий `authLimiter` на `/auth/login`, `webhookLimiter` на вебхук (`middleware/rateLimit.js`). Блокировка учётки на 15 мин после 8 неудачных входов подряд + счётчик `users.failed_login_count` / `users.locked_until` (`authController.login`, миграция + `schema.sql`). Проверено: 11-я попытка входа → 429; CORS-allowlist отдаёт ACAO только своим origin |
| P0-4 | Прозрачная миграция старых несолёных SHA-256-хэшей на bcrypt при первом успешном входе (`authController.login`). Отчётный скрипт `src/tools/reportLegacyHashes.js` — сейчас таких учёток **5** (все `dir_head`/`hrbp`, ни разу не входили). SHA-ветку в `verifyPassword` убрать, когда список опустеет |
| P1-6 | CORS по белому списку вместо `cors()` `*`; переопределяется `CORS_ORIGINS` (`server.js`) |
| P1-7 | Убран приём JWT из `?token=` query (`middleware/auth.js`); `jwt.verify`/`jwt.sign` с явным `algorithms: ['HS256']`. **Осталось:** короткоживущая подписанная ссылка для `export-csv`, срок токена < 30 дней + refresh |
| P1-8 | `app.set('trust proxy', 1)` (`server.js`) — реальный `req.ip` за прокси Render |
| P1-5 | Включён CSP вместо `contentSecurityPolicy:false` (`server.js`): внешние ресурсы только `telegram.org` + Google Fonts, `frame-ancestors` только Telegram, `object-src 'none'`, `base-uri`/`form-action` `'self'`. `script-src`/`script-src-attr` оставляют `'unsafe-inline'` (во фронте много инлайнового JS и ~20 `onclick=`). `X-Frame-Options` снят (перебивал бы `frame-ancestors`). Проверено локально: страница 200, заголовок выставляется |
| P1-9 | `csvCell()` — гасит CSV-инъекцию (ведущие `= + - @` \t \r → апостроф) в `dashboardController.exportCSV` и в клиентском `exportDashboardCSV` (`public/index.html`) |
| P1-10 | `missingSecrets()`: при заданном `TELEGRAM_BOT_TOKEN` требует и `TELEGRAM_WEBHOOK_SECRET` (`config/index.js`) |

Новая зависимость: `express-rate-limit@^7.5.1`.

**P0-1 (ротация секретов) — выполнена 2026-08-31** вручную: `JWT_SECRET`, `TURSO_AUTH_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` заменены в Render + `.env`, `setWebhook` перерегистрирован. Прод проверен: `/health` `db:ok`, вход и бот работают. На `farovon-market-analysis` (боевая база) сделан Turso `Invalidate tokens` — утёкший в git RW-токен теперь мёртв. Детали и остаточные хвосты — в P0-1 ниже.

✅ Ветка влита в `main` (`062e099`) и задеплоена на Render 2026-08-31. Прод проверен: `/health` `db:ok` (миграция `failed_login_count`/`locked_until` прошла), CSP-заголовок отдаётся, `X-Frame-Options` снят, `?token=` в query → 401, битый логин → 401 (не 500), CORS чужому origin не отдаёт ACAO.

Остаётся проверить вручную: **Telegram Mini App открывается в бою** (новый CSP + снятый XFO) и **вход реального пользователя** (новый `JWT_SECRET`).

---

## P0 — критично

### P0-1 ✅ Ротация секретов из git-истории (сделано 2026-08-31)
`src/config/index.js:4-6` фиксирует: RW-токен Turso и `JWT_SECRET` ранее были захардкожены и попали в историю git (коммиты `f453d75`, `2e722d1`; убраны в `4255edf`).

**Разбор баз Turso:**
- **`farovon-market-analysis`** (Database, родитель) — **боевая база**. Подтверждено значением `TURSO_DATABASE_URL` в Render. Утёкший в историю RW-токен (`id БД 01a02e8e…`) был выписан именно на неё.
- **`farovon`** (Branch, снимок от 23.08) — старая боковая копия. Локальный `.env` по ошибке смотрел на неё, поэтому ранние подсчёты («111 пользователей», «5 SHA-хэшей») были по этой копии, а не по проду.
- `.env` в git никогда не коммитился (`git log -- .env` пуст) — токен ветки `farovon` не утекал.

- [x] `JWT_SECRET` — заменён в Render + `.env` (все сессии разлогинены, вход проверен)
- [x] `TURSO_AUTH_TOKEN` — новый на Render; прод `/health` → `db:ok`
- [x] `TELEGRAM_WEBHOOK_SECRET` — новый (64 hex) в Render + `.env` + `setWebhook`; бот отвечает
- [x] **Turso `Invalidate tokens` на `farovon-market-analysis`** — утёкший в git RW-токен инвалидирован (ключ подписи повёрнут)
- [ ] `TELEGRAM_BOT_TOKEN` — НЕ ротирован (в истории не найден; по желанию через @BotFather)
- [ ] Проверить историю на `ADMIN_PASSWORD` / `CB_PASSWORD` (`src/tools/generateDataBundle.js`, `cleanTurso.js`)
- [ ] Локальный `.env` перенастроить на `farovon-market-analysis` (боевую) + токен для неё — помощник `scratch/point-to-prod-db.js`
- [ ] Удалить локальные `.env.bak.*` (в них старые секреты) и `scratch/*.js`

### P0-A ⬜ Тестовые учётки в проде
В боевой базе живут 6 аккаунтов `testovyy.*` (создан 29.08). Среди них **`testovyy.a` — активная роль `admin`**, вход 31.08 — фактически чёрный ход с, вероятно, простым паролем.

- [ ] Заархивировать/удалить все `testovyy.*` перед боевым запуском
- [ ] В первую очередь — `testovyy.a` (тестовый администратор)

### P0-2 ✅ Эскалация привилегий в `saveUser`
`src/controllers/adminController.js:112-210`. `VALID_ROLES` включает `'admin'`; нет проверки, что не-admin не может создать/повысить пользователя (или себя) до `admin`. Единственная защита — «последний админ». Как только конструктор ролей выдаёт `users:create`/`users:edit` роли `cb`/`hrbp`, эта роль может выписать себе admin-учётку.

- [x] `if (targetRole === 'admin' && req.user.role !== 'admin') → 403`
- [x] Запретить не-админу менять `role` и `active` у существующего пользователя с `role='admin'`
- [ ] (опц.) запретить назначать роль «выше» своей — таблица старшинства ролей

### P0-3 ✅ Нет rate-limiting и защиты от брутфорса
Ни `express-rate-limit`, ни lockout (поиск по `src/` пуст). `/api/auth/login` брутфорсится без ограничений. Временный пароль `Fv-` + 6 симв. из 31-буквенного алфавита ≈ 30 бит; пользовательский — минимум 6 символов без требований (`authController.js:451`).

- [x] `express-rate-limit` на `/api/auth/login` (10 / 15 мин на IP, `skipSuccessfulRequests`)
- [x] `express-rate-limit` на `/api/telegram/webhook` (240 / мин)
- [x] Мягкий глобальный лимит на `/api` (600 / 5 мин)
- [x] Счётчик неудачных входов + временная блокировка учётки (`users.failed_login_count`/`locked_until`, 8 попыток → блок 15 мин)
- [x] Политика пароля: минимум 8 символов, буква + цифра (`passwordPolicyError`); временный пароль — 8 символов с гарантированной цифрой и буквой

### P0-4 🟡 Устаревший fallback на несолёный SHA-256
`src/controllers/authController.js:13-25`. `verifyPassword` принимает `sha256(password)` без соли — ломается радужными таблицами. Пользователи, не менявшие пароль после миграции, до сих пор с таким хэшем.

- [x] При успешном входе по SHA-ветке — сразу перехэшировать в bcrypt и записать (`authController.login`)
- [x] Разовый скрипт: отчёт, у кого ещё `password_hash` не `$2a/$2b/$2y` (`src/tools/reportLegacyHashes.js`) — сейчас 5 учёток
- [ ] После миграции всех — удалить SHA-ветку из `verifyPassword`

---

## P1 — важно

### P1-5 ✅ CSP полностью выключен
`src/server.js:41-43`: `helmet({ contentSecurityPolicy: false })`. Фронт — большой `index.html` с обилием `innerHTML` и пользовательскими данными (компании, ФИО, заметки).

- [x] CSP включён с директивами (см. server.js). script-src оставляет 'unsafe-inline' — осознанный компромисс под текущий фронт
- [ ] Проверить Telegram Mini App в бою после включения CSP (локально страница грузится)

### P1-6 ✅ CORS открыт всем
`src/server.js:40`: `app.use(cors())` → `Access-Control-Allow-Origin: *`.

- [x] `cors({ origin: <allowlist>, credentials: false })` — список из `CORS_ORIGINS` или дефолт (`webappUrl` + `web.telegram.org` + onrender)

### P1-7 ✅ JWT из query-строки + длинный срок жизни
`src/middleware/auth.js:15-17` принимает `req.query.token`; `morgan('dev')` пишет URL и на проде; `config.jwtExpiresIn = '30d'` (`config/index.js:11`).

- [x] Убрать приём токена из query (`middleware/auth.js`)
- [x] `jwt.verify` / `jwt.sign` с `algorithms: ['HS256']`
- [ ] Для `/api/dashboard/export-csv` — короткоживущая подписанная ссылка (сейчас фронт формирует CSV сам, серверный эндпоинт UI не вызывает)
- [x] Срок токена 30д → 7д (JWT_EXPIRES_IN override); persistToken() сохраняет свежий токен при каждом /auth/resume + тихое продление раз в 3ч и при возврате на вкладку

### P1-8 ✅ `trust proxy` не выставлен
`src/server.js`: нет `app.set('trust proxy', 1)`. За прокси Render `req.ip` = IP прокси → IP в `audit_log` бесполезны (`authController.js:411-416`).

- [x] `app.set('trust proxy', 1)` (`server.js`)

### P1-9 ✅ CSV-injection
`/api/dashboard/export-csv` отдаёт CSV из пользовательских данных; значения на `= + - @` исполняются в Excel.

- [x] csvCell() экранирует ведущие = + - @ 	  (сервер + клиент)
- [x] `cleanCell()` в `surveyImport.js` — вычищает C0-контролы/переносы строк из текстовых ячеек импорта

### P1-10 ✅ `TELEGRAM_WEBHOOK_SECRET` не обязателен
Не входит в `REQUIRED_SECRETS` (`config/index.js:20-24`). Сейчас fail-closed, но по `.env.example` секрет «обязателен при заданном боте».

- [x] missingSecrets(): TELEGRAM_WEBHOOK_SECRET обязателен при заданном TELEGRAM_BOT_TOKEN

---

## Новое — журнал выгрузок данных (по запросу)

CSV на дашборде собирается в браузере (сервер файла не видит). Перед скачиванием фронт вызывает `POST /api/audit/export` → запись в `audit_log`: `login`, `action='экспорт данных'`, `detail` = формат / раздел / число строк / фильтры / User-Agent, `ip`, `created_at`.

- [x] эндпоинт `dashboardController.logExport` + маршрут (кап `dashboard:view`)
- [x] вызов из `exportDashboardCSV` (не блокирует скачивание при сбое журнала)
- [ ] показать эти записи в админ-журнале с фильтром по действию (сейчас только в общей ленте)

## P2 — харденинг

- [ ] **Принудительная смена временного пароля** при первом входе (пока только текст-рекомендация)
- [x] **Экранирование HTML** в сообщениях бота — `escHtml()` на ФИО/логин/пароль
- [x] **`errorHandler`** — 5xx → «Внутренняя ошибка сервера», детали только в лог; текст 4xx остаётся
- [x] **bcrypt cost** 10 → 12 (`authController`, `adminController`, `telegramController`)
- [x] **`crypto.timingSafeEqual`** для сравнения вебхук-секрета (`safeEqual()`)
- [ ] **`npm audit` / Dependabot** в CI (на выходных подняли `node-telegram-bot-api` 0.66→2.1, −9 алертов — закрепить процессом)
- [ ] **Проход по `innerHTML`** во фронте `public/index.html` — отдельная задача (крупнейшая непроверенная XSS-поверхность)
- [ ] **Скоуп токена Turso** — минимально необходимые права; отдельные токены для оффлайн-скриптов
- [ ] **`express.json({ limit })`** — снизить для обычных роутов, 10 МБ оставить только на импорт
- [ ] `router.all()` на `/api/dashboard/*` (`routes/api.js:36-37`) — сузить до нужных методов
- [ ] Проверить, что helmet HSTS не переопределён

---

## Что уже сделано хорошо (не трогать)

- Секреты без дефолтов, сервис падает при их отсутствии (`config/index.js`, `server.js:17-22`)
- Все SQL — параметризованные (`db/database.js`), динамические `IN (...)` через `?`, имена таблиц из белого списка `KINDS` (`dictionaryController.js`)
- RBAC через `role_capabilities`, `hasCapability` fail-closed при ошибке Б:Д (`middleware/auth.js:71-100`)
- `authMiddleware` перечитывает пользователя из БД на каждом запросе → блокировка (`active=0`) и смена роли действуют сразу
- Админ больше не видит/не задаёт пароли; сброс — только доставкой в Telegram (`telegramController.js:117-159`)
- Учётка `admin` защищена от удаления/разжалования/деактивации (последний админ)
- Вебхук Telegram проверяет секретный заголовок, fail-closed без секрета (`telegramController.js:319-323`)
- `audit_log` по входам и админ-действиям
- `request_contact` при привязке по телефону проверяет `contact.user_id === from.id`
- Одноразовый токен привязки Telegram с TTL 10 мин
