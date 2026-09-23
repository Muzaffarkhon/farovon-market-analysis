# План реализации: этап 9 (правки безопасности)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CSRF-защита на мутирующих запросах; CSP без `unsafe-inline`
для `/new/*`; права роли C&B сужены до рабочих функций; мягкое удаление
датасетов бенчмаркинга. Не входит: отключение старого клиента, удаление
легаси-хешей паролей (3 живых пользователя в проде), миграция
пользователь↔подразделение на FK, мягкое удаление подразделений/
справочников (уже достаточно защищены).

**Architecture:** Новый `src/middleware/csrf.js`, правка
`setSessionCookie`/точек её вызова в `authController.js`, второй
`helmet()`-инстанс для `/new` в `server.js`, правка
`DEFAULT_ROLE_CAPABILITIES.cb` в `capabilities.js`, `archived_at` на
`benchmark_datasets`. Клиент — по одной точке правки на каждый (`request()`
в новом, `call()` в старом).

**Tech Stack:** тот же, что в этапах 0–8. `node:crypto` для CSRF-токена,
без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-09-24-security-fixes-design.md`.

## Global Constraints

- Не трогаем ветку легаси SHA-256 в `verifyPassword` — 3 живых
  пользователя в проде всё ещё на таких хешах (прод-проверка 24.09).
- Не трогаем `deleteDivision`/`dictionaryController.remove` — уже
  защищены проверкой использования/подтверждением.
- Не меняем `sameSite`/`httpOnly` у существующей куки сессии.
- CSRF-проверка пропускает запросы, аутентифицированные заголовком
  `Authorization`/`X-Token` (Telegram Mini App) — им кука не нужна и
  подделать заголовок межсайтовым запросом нельзя.
- Сужение прав `cb` — только дефолт для `INSERT OR IGNORE` при
  миграции; синхронизация уже выданных в проде прав — отдельный ручной
  шаг после этого коммита, не часть его.

## Карта файлов

- `src/middleware/csrf.js` — новый
- `src/controllers/authController.js` — `setCsrfCookie`, вызовы в
  `login`/`resume`/`telegramLogin`/смене пароля
- `src/routes/api.js` — подключение `csrfProtect`, исключения для
  публичных/секрет-защищённых маршрутов
- `web/src/api/client.ts` — заголовок `X-CSRF-Token`
- `client/app-core.js` — то же в `call()`
- `src/server.js` — второй `helmet()` для `/new`
- `src/config/capabilities.js` — `DEFAULT_ROLE_CAPABILITIES.cb`
- `src/db/migrate.js` — `benchmark_datasets.archived_at`
- `src/services/benchmarkService.js` — `deleteDataset`, `listDatasets`

---

### Task 1: CSRF-защита

**Files:** Create: `src/middleware/csrf.js` + тест
Modify: `authController.js`, `src/routes/api.js`, `web/src/api/client.ts`,
`web/src/api/client.test.ts`, `client/app-core.js`

- [ ] **Step 1: Тесты**

`csrfProtect`: GET пропускается без проверки; POST с заголовком
`Authorization` пропускается; POST по куке без токена/с несовпадающим —
403; с совпадающим — пропускается. Клиентский `request()` добавляет
`X-CSRF-Token` на POST, не добавляет на GET.

- [ ] **Step 2: Реализация сервера**

`csrf.js` (спека §2.3). `setCsrfCookie` рядом с `setSessionCookie` во
всех 4 точках вызова. Подключить в `api.js` с исключениями
(`/auth/login`, `/auth/telegram`, `/auth/logout`, `/telegram/webhook`,
`/cron/reminders`).

- [ ] **Step 3: Оба клиента**

`web/src/api/client.ts` — читать `farovon_csrf` из `document.cookie`,
слать `X-CSRF-Token` на не-GET. `client/app-core.js` — то же в `call()`.

- [ ] **Step 4: Прогнать вручную (на dev-данных: войти в новый клиент,
  сохранить что угодно мутирующее — например профиль или подразделение
  — убедиться что проходит; вручную curl'ом без заголовка на тот же
  маршрут с сессионной кукой — получить 403; убедиться что вход и вебхук
  бота по-прежнему работают без токена), commit**

```bash
git add src web client
git commit -m "feat(безопасность): CSRF-защита мутирующих запросов (double-submit cookie)"
```

---

### Task 2: CSP без `unsafe-inline` для `/new/*`

**Files:** Modify: `src/server.js`

- [x] **Step 1: Реализация**

Второй `helmet()`-инстанс с `script-src`/`script-src-attr` без
`'unsafe-inline'`, подключить `app.use('/new', ...)` до общего
CSP-мидлвара (спека §3). По факту `app.use` по пути не прерывает
цепочку в Express — оба инстанса собраны в один мидлвар, который сам
выбирает нужный по `req.path`. Инлайн-скрипт инициализации темы в
`web/index.html` (не onclick, честный `<script>`) закрыт хешем
`sha256-...`, посчитанным динамически от собранного `client/next/
index.html` при каждом запуске сервера (с нормализацией `\r\n → \n`,
как это делает браузер при парсинге HTML) — переживёт правку скрипта
без ручной синхронизации.

- [x] **Step 2: Прогнать вручную (открыть `/new` на dev-сервере,
  проверить заголовок `Content-Security-Policy` в ответе — нет
  `unsafe-inline` в `script-src`; убедиться что новый клиент работает
  без консольных ошибок нарушения CSP; открыть старый клиент `/` —
  заголовок как был, с `unsafe-inline`), commit**

```bash
git add src/server.js
git commit -m "feat(безопасность): CSP без unsafe-inline для /new (новый клиент)"
```

---

### Task 3: Права роли C&B

**Files:** Modify: `src/config/capabilities.js`

- [ ] **Step 1: Реализация**

`DEFAULT_ROLE_CAPABILITIES.cb` — убрать `users:create`, `users:edit`,
`broadcast:send`, `service:edit` (спека §4), оставить остальное.
Обновить комментарий на месте (объяснить, почему сузили и когда).

- [ ] **Step 2: Прогнать (`npm test` — существующие тесты на дефолтные
  права не должны сломаться; вручную на dev-данных: создать тестового
  cb-пользователя, убедиться что видит все разделы кроме «Пользователи»
  (создание/правка) и «Рассылка»), commit**

```bash
git add src/config/capabilities.js
git commit -m "fix(безопасность): роль C&B по умолчанию без управления учётками и рассылок"
```

---

### Task 4: Мягкое удаление датасетов бенчмаркинга

**Files:** Modify: `src/db/migrate.js`, `src/services/benchmarkService.js`

- [x] **Step 1: Тест** — в этом репо нет прецедента DB-тестов (все
  тесты в `test/` — чистые функции без БД), поэтому проверено вручную
  на dev-БД напрямую через `benchmarkService` (см. Step 3), без нового
  test-файла.

- [x] **Step 2: Реализация**

`ensureColumn('benchmark_datasets', 'archived_at', 'DATETIME')`.
`deleteDataset(id, login)` → `UPDATE ... SET archived_at =
CURRENT_TIMESTAMP` вместо `DELETE` (строки `benchmark_rows` теперь не
трогает — история жива для восстановления). `getDatasets` — `WHERE
d.archived_at IS NULL`; запрос строк в `compare` тоже игнорирует
архивные датасеты (`bd.archived_at IS NULL`). Запись в `audit_log`
(`login` берётся из `req.user.login` в контроллере).

- [x] **Step 3: Прогнать вручную (на dev-данных: удалить тестовый
  датасет через интерфейс, убедиться что пропал из списка, но строка
  жива в БД), commit** — прогнано напрямую через `benchmarkService.
  deleteDataset` на `data/dev.db`: датасет пропал из `getDatasets()`,
  строка осталась с `archived_at`, запись в `audit_log` появилась;
  тестовые данные удалены после проверки.

```bash
git add src
git commit -m "fix(безопасность): мягкое удаление датасетов бенчмаркинга вместо DELETE"
```

---

### Task 5: Финальная проверка этапа

- [ ] **Step 1:** `npm test`, `npm --prefix web test`, `npm --prefix web run build`
- [ ] **Step 2:** Сквозная проверка — старый клиент по-прежнему
  полностью работает (вход, сохранение анкеты, админка) под CSRF и CSP
  правками.
- [ ] **Step 3:** Commit

```bash
git commit -m "docs: этап 9 (безопасность) — план выполнен целиком" --allow-empty
```
