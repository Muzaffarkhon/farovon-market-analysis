# Security review — «Обзор рынка» / Farovon Market Analysis

**Дата:** 2026-08-31
**Ветка:** `main` · последний коммит ревью — `c19ce4b`
**Область:** backend Node/Express + Turso LibSQL + Telegram-бот (`src/`), фронтенд `public/index.html` (включая проход по XSS), инфраструктура (Render, Turso, GitHub).

**Статус: закрыт.** Все P0, P1 и P2 из чек-листа реализованы и задеплоены на прод. Осталось несколько действий вне репозитория (ниже).

---

## Итог

| # | Пункт | Статус |
|---|---|---|
| **P0-1** | Ротация секретов из git-истории (`JWT_SECRET`, `TURSO_AUTH_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`) + `Invalidate tokens` на боевой базе Turso | ✅ на проде |
| **P0-2** | Гард эскалации в `saveUser` — не-admin не выпишет admin-учётку | ✅ на проде |
| **P0-3** | Rate-limiting (`express-rate-limit`) + блокировка учётки после 8 неудач + политика пароля (≥8, буква+цифра) | ✅ на проде |
| **P0-4** | Прозрачная миграция несолёных SHA-256 → bcrypt при входе + отчётный скрипт | ✅ на проде (ветку SHA убрать позже) |
| **P1-5** | CSP включён (был `false`); внешка только `telegram.org` + Google Fonts; framing только Telegram | ✅ на проде, Mini App проверен |
| **P1-6** | CORS по белому списку вместо `*` | ✅ на проде |
| **P1-7** | JWT только из заголовка + `algorithms:['HS256']`; срок 30д → 7д со скользящим продлением | ✅ на проде |
| **P1-8** | `trust proxy` — реальный `req.ip` за прокси Render | ✅ на проде |
| **P1-9** | CSV-инъекция: `csvCell()` на выгрузке (сервер+клиент) + `cleanCell()` на импорте | ✅ на проде |
| **P1-10** | `TELEGRAM_WEBHOOK_SECRET` обязателен при заданном боте | ✅ на проде |
| **P2** | Принудительная смена временного пароля; экранирование в боте; generic-ошибки 5xx; `timingSafeEqual`; bcrypt cost 12; XSS-аудит + харденинг `esc()`; лимиты тела запроса; `router.post` вместо `router.all`; HSTS подтверждён | ✅ на проде |
| **CI** | GitHub Actions (`npm audit` high+, syntax-gate, frontend-audit) + Dependabot | ✅ зелёный |
| **Доп.** | Журнал выгрузок данных (`POST /api/audit/export` → `audit_log`) | ✅ на проде |

**`npm audit` (прод-зависимости): 0 уязвимостей.**

### Проверено на проде

- `/health` → `{ok:true, db:"ok"}`; все миграции применены к боевой базе `farovon-market-analysis`
- CSP-заголовок отдаётся; `X-Frame-Options` снят (framing контролит `frame-ancestors`)
- `strict-transport-security: max-age=31536000; includeSubDomains`
- `?token=` в query → `401`; битый логин → `401` (не 500)
- 11-я попытка входа за окно → `429`; чужой `Origin` → без `Access-Control-Allow-Origin`
- POST 700 КБ на обычный роут → `413`
- Telegram Mini App открывается; вход реального пользователя работает (после ротации `JWT_SECRET`)
- CI на `main` (`c19ce4b`) — все шаги `success`

### Остаточные задачи (вне репозитория / отложены)

- [ ] **Снести `testovyy.*` из прода** (6 учёток, среди них активный `testovyy.a` с ролью admin) — админка → архив. Пункт P0-A.
- [ ] **Dependabot #39** (`actions/setup-node` v4→v7) — домержить через веб GitHub: локальный токен `gh` без scope `workflow`.
- [ ] **Dependabot #42 / #43 / #44** (express 5, csv-parse 7, bcryptjs 3) — major/ломающие, мержить отдельно с проверкой (вход / импорт опроса).
- [ ] **Убрать SHA-ветку в `verifyPassword`** — когда все оставшиеся легаси-хэши мигрируют. Проверять: `node src/tools/reportLegacyHashes.js`.
- [ ] **`TELEGRAM_BOT_TOKEN`** — в git-истории не найден; ротация по желанию через @BotFather.
- [ ] **Скоуп токена Turso** — минимально необходимые права; отдельные токены для оффлайн-скриптов.
- [ ] Проверить историю на `ADMIN_PASSWORD` / `CB_PASSWORD` (`src/tools/generateDataBundle.js`, `cleanTurso.js`).
- [ ] (опц.) Показать записи «экспорт данных» в админ-журнале отдельным фильтром.
- [ ] (опц.) Таблица старшинства ролей — запретить назначать роль «выше» своей.

---

## P0 — критично

### P0-1 ✅ Ротация секретов из git-истории
`src/config/index.js` фиксирует: RW-токен Turso и `JWT_SECRET` ранее были захардкожены и попали в историю git (коммиты `f453d75`, `2e722d1`; убраны в `4255edf`).

**Разбор баз Turso:**
- **`farovon-market-analysis`** (Database, родитель) — **боевая база**. Подтверждено значением `TURSO_DATABASE_URL` в Render. Утёкший в историю RW-токен (`id БД 01a02e8e…`) был выписан именно на неё.
- **`farovon`** (Branch, снимок от 23.08) — старая боковая копия. Локальный `.env` по ошибке смотрел на неё, отсюда ранние подсчёты «111 пользователей» / «5 SHA-хэшей».
- `.env` в git никогда не коммитился (`git log -- .env` пуст).

- [x] `JWT_SECRET` — заменён в Render + `.env` (все сессии разлогинены, вход проверен)
- [x] `TURSO_AUTH_TOKEN` — новый на Render + `.env`; `/health` → `db:ok`
- [x] `TELEGRAM_WEBHOOK_SECRET` — новый (64 hex) в Render + `.env` + `setWebhook`; бот отвечает
- [x] **Turso `Invalidate tokens` на `farovon-market-analysis`** — утёкший RW-токен инвалидирован (ключ подписи повёрнут)
- [x] Локальный `.env` перенастроен на боевую базу (120 пользователей), `.env.bak.*` и хелпер-скрипты удалены
- [ ] `TELEGRAM_BOT_TOKEN` — не ротирован (в истории не найден; по желанию)
- [ ] Проверить историю на `ADMIN_PASSWORD` / `CB_PASSWORD`

### P0-A ⬜ Тестовые учётки в проде
В боевой базе живут 6 аккаунтов `testovyy.*` (созданы 29.08). Среди них **`testovyy.a` — активная роль `admin`**, вход 31.08 — фактически чёрный ход с простым паролем.

- [ ] Заархивировать/удалить все `testovyy.*` перед боевым запуском
- [ ] В первую очередь — `testovyy.a`

### P0-2 ✅ Эскалация привилегий в `saveUser`
`VALID_ROLES` включал `'admin'`; не было проверки, что не-admin не может создать/повысить пользователя до `admin`.

- [x] `if (targetRole === 'admin' && req.user.role !== 'admin') → 403`
- [x] Запретить не-админу менять `role`/`active` у существующего пользователя с `role='admin'`
- [x] `VALID_ROLES` теперь читается из БД-справочника ролей (конструктор ролей)
- [ ] (опц.) таблица старшинства ролей

### P0-3 ✅ Rate-limiting и защита от брутфорса
- [x] `express-rate-limit` на `/api/auth/login` (10 / 15 мин на IP, `skipSuccessfulRequests`)
- [x] `express-rate-limit` на `/api/telegram/webhook` (240 / мин)
- [x] Мягкий глобальный лимит на `/api` (600 / 5 мин)
- [x] Счётчик неудачных входов + блок учётки (`users.failed_login_count`/`locked_until`, 8 → 15 мин)
- [x] Политика пароля: ≥8 символов, буква + цифра; временный пароль 8 символов с гарантированной цифрой и буквой

### P0-4 ✅ Устаревший fallback на несолёный SHA-256
- [x] При успешном входе по SHA-ветке — сразу перехэшировать в bcrypt (`authController.login`)
- [x] Отчётный скрипт `src/tools/reportLegacyHashes.js`
- [ ] Удалить SHA-ветку из `verifyPassword` — когда список опустеет

---

## P1 — важно

### P1-5 ✅ CSP включён
`helmet` с директивами (`server.js`): `default-src 'self'`; `script-src`/`style-src` — `'self' 'unsafe-inline'` + `telegram.org` / Google Fonts (инлайнового JS/CSS во фронте слишком много, чтобы хешировать); `frame-ancestors` только Telegram; `object-src 'none'`; `base-uri`/`form-action` `'self'`. `X-Frame-Options` снят (`frameguard:false`), иначе перебивал бы `frame-ancestors`. Проверено: Mini App в Telegram открывается.

### P1-6 ✅ CORS по белому списку
`cors({ origin: <allowlist>, credentials: false })` — список из `CORS_ORIGINS` или дефолт (`webappUrl` + `web.telegram.org` + onrender-домен).

### P1-7 ✅ JWT из query + длинный срок
- [x] Убран приём токена из `?token=` (`middleware/auth.js`)
- [x] `jwt.verify` / `jwt.sign` с `algorithms:['HS256']`
- [x] Срок 30д → 7д (`JWT_EXPIRES_IN` override); `persistToken()` сохраняет свежий токен при каждом `/auth/resume`; тихое продление раз в 3 ч и при возврате на вкладку
- N/A серверный `export-csv` — UI формирует CSV в браузере, эндпоинт не вызывается

### P1-8 ✅ `trust proxy`
`app.set('trust proxy', 1)` — реальный `req.ip` за прокси Render (IP в `audit_log` снова осмысленны).

### P1-9 ✅ CSV-injection
- [x] `csvCell()` — ведущие `= + - @` \t \r → апостроф, в `dashboardController.exportCSV` и клиентском `exportDashboardCSV`
- [x] `cleanCell()` в `surveyImport.js` — вычищает control-символы / переносы строк из текстовых ячеек импорта

### P1-10 ✅ `TELEGRAM_WEBHOOK_SECRET` не обязателен
`missingSecrets()`: при заданном `TELEGRAM_BOT_TOKEN` секрет вебхука теперь обязателен.

---

## P2 — харденинг (всё ✅)

- [x] **Принудительная смена временного пароля** — флаг `users.must_change_password` (ставит бот при выдаче временного, снимает `changePassword`); `authMiddleware` пускает такого юзера только на `/auth/change-password` и `/auth/resume`; фронт форсит запертое окно смены (без кнопки закрытия, клик по фону игнорируется)
- [x] **Экранирование HTML** в сообщениях бота — `escHtml()` на ФИО/логин/пароль
- [x] **`errorHandler`** — 5xx → «Внутренняя ошибка сервера», детали только в лог; текст 4xx остаётся
- [x] **bcrypt cost** 10 → 12 (`authController`, `adminController`, `telegramController`)
- [x] **`crypto.timingSafeEqual`** для вебхук-секрета (`safeEqual()`)
- [x] **CI + Dependabot** — `.github/workflows/ci.yml` (`npm ci` → `npm audit --omit=dev --audit-level=high` → syntax-gate → `auditFrontend` → `npm test`) + `.github/dependabot.yml` (еженедельные PR, мелочь сгруппирована)
- [x] **XSS-аудит фронта** — `esc()` применяется системно (пред-экранирование в переменные); нет single-quote-атрибутов с подстановкой; нет `value`/`dataset`→`innerHTML`; нет `eval`/`new Function`/`document.write`/`insertAdjacentHTML`; `ask({html})` везде статичный или `esc()`. Живой дыры не найдено. Харденинг: `esc()` теперь гасит и одинарную кавычку (`&#39;`)
- [x] **Лимиты тела запроса** — `express.json` 512 КБ на обычных роутах, отдельный парсер 15 МБ только на `/api/admin/import-survey`; `urlencoded` 512 КБ
- [x] **`router.all` → `router.post`** на `/api/dashboard/{extended,hrbp}`
- [x] **HSTS** — helmet ставит по умолчанию, на проде `max-age=31536000; includeSubDomains`, не переопределён
- [ ] **Скоуп токена Turso** — минимальные права; отдельные токены для оффлайн-скриптов (вне репозитория)

---

## Журнал выгрузок данных

CSV на дашборде собирается в браузере (сервер файла не видит). Перед скачиванием фронт вызывает `POST /api/audit/export` → запись в `audit_log`: `login`, `action='экспорт данных'`, `detail` = формат / раздел / число строк / фильтры / User-Agent, `ip`, `created_at`.

- [x] эндпоинт `dashboardController.logExport` + маршрут (кап `dashboard:view`)
- [x] вызов из `exportDashboardCSV` (не блокирует скачивание при сбое журнала)
- [ ] (опц.) отдельный фильтр по этому действию в админ-журнале

---

## Что уже было сделано хорошо (не трогали)

- Секреты без дефолтов, сервис падает при их отсутствии (`config/index.js`, `server.js`)
- Все SQL — параметризованные (`db/database.js`); динамические `IN (...)` через `?`; имена таблиц из белого списка `KINDS`
- RBAC через `role_capabilities`; `hasCapability` fail-closed при ошибке БД
- `authMiddleware` перечитывает пользователя из БД на каждом запросе → блокировка (`active=0`) и смена роли действуют сразу
- Админ не видит и не задаёт пароли; сброс — только доставкой в Telegram
- Учётка `admin` защищена от удаления/разжалования/деактивации (последний админ)
- Вебхук Telegram проверяет секретный заголовок, fail-closed без секрета
- `audit_log` по входам и админ-действиям
- `request_contact` при привязке по телефону проверяет `contact.user_id === from.id`
- Одноразовый токен привязки Telegram с TTL 10 мин
