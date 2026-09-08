# ОБЗОР РЫНКА (FAROVON MARKET ANALYSIS) — Strict Engineering Rules

## ПРИОРИТЕТЫ (в порядке убывания)
1. Безопасность прод 24/7 (Turso LibSQL, Render, Telegram Webhook)
2. Точность данных C&B (зарплатные вилки, перцентили P25/P50/P75, оргструктура 326 отделов)
3. Честная критика запросов
4. Минимальные изменения

## СТАТУСЫ
- `[ГИПОТЕЗА]` — предположение без проверки
- `[НЕИЗВЕСТНО]` — нет данных
- `[НЕТ ДОСТУПА: файл]` — файл не прочитан
- НЕ говорить «сделано/исправлено» без вывода терминала, diff или лога.

## [STATE] БЛОК (только для запросов кода/изменений)
```
Контекст: ...
Критика запроса: ... (если идея плохая — откажи)
Win: ... | Lose: ... (что сломается на проде 24/7)
Откат: ... (точная команда)
```
На вопросы-справки, чтение файлов и короткие уточнения — БЕЗ [STATE].

## GATEKEEPING
Перед записью файла / `git commit` / `git push` / `deploy`:
```
[ОЖИДАНИЕ ПОДТВЕРЖДЕНИЯ]
Действие: ...
Риски: ...
Подтвердите (Да/Нет).
```
Без явного «Да» — не выполнять.

## ЗОЛОТЫЕ ПРАВИЛА «ОБЗОР РЫНКА»
1. **Admin Protection:** Запрещено программно или через UI удалять, архивировать (`active = 0`) или понижать роль системного пользователя `admin`.
2. **Turso LibSQL Safety:** Запрещены деструктивные `DROP TABLE / DROP DATABASE` без бэкапа. Миграции в `src/db/migrate.js` строго идемпотентны (`IF NOT EXISTS`, проверка колонок).
3. **C&B Расчёты:** Формулы перцентилей (P25, P50/Медиана, P75), размаха вилок (`((max-min)/min)*100`) — обязательна защита от деления на ноль, `NaN` и валидация `salary_min <= salary_max`.
4. **Scope & RBAC Isolation:** Руководитель направления (`dir_head`) видит и назначает сотрудников **строго внутри своего направления** (`dir`). Исключить утечку списка всех 112+ сотрудников.
5. **Смежные группы (`group_key`):** Объединение должностей на Шаге 2 и подсказки компаний на Шаге 1 работают по `group_key` — **без смешивания фактических окладов и данных surveys между разными unit**.
6. **Bcrypt & Auth:** Запрещено сохранять пароли в открытом виде (`raw_password` удалён). Пароли — только `bcryptjs.hash(pw, 10)`. JWT сессии с поддержкой кириллицы (UTF-8).
7. **Frontend Audit Sync:** Vanilla JS/CSS SPA в `client/index.html` и `client/style.css`. Любое добавление `call(api)` обязано быть синхронизировано с маршрутами в `src/server.js` (33 эндпоинта) и проходить `src/tools/auditFrontend.js`.
8. **Telegram Bot & Webhook:** Рассылка напоминаний — с задержками (anti-flood, max 25 msg/s), обработка `403 Forbidden` (пользователь заблокировал бота). Команды бота (`/status`, `/unlink`, `/help`) должны быть синхронизированы в `setMyCommands`.
9. **Audit Logging:** Все критические действия (назначение ответственных, сброс паролей, архивация, раздача пула компаний, удаление анкет) обязаны фиксироваться в таблице `audit_log`.
10. **Apple HIG & 22 SVG:** Интерфейс строится строго по дизайн-токенам Apple HIG (десктопный сайдбар, адаптивные таблицы, компактный режим `html.compact` для мобильных/TMA, 22 векторные SVG-иконки без эмодзи в кнопках и табах).

## PRE-DEPLOY CI GATE (автозапуск локально)
```powershell
node src/tools/auditFrontend.js
node --check src/server.js
node --check src/db/migrate.js
node --check src/config/capabilities.js
```
Ошибка → статус «НЕ ГОТОВО». Деплой заблокирован.

## ПОТЕРЯ КОНТЕКСТА (после 5+ сообщений)
Стоп и спроси: бранч? миграции в Turso применились? auditFrontend.js проходит?

## PROJECT CONTEXT
- **«Обзор рынка»** / `farovon-market-analysis` — корпоративная C&B система мониторинга рынка труда, зарплатных вилок и льгот ГК «Фаровон»
- **Стек:** Node.js 20+, Express 4.21, `@libsql/client` (Turso Cloud LibSQL SQLite), `bcryptjs`, `jsonwebtoken`, `node-telegram-bot-api`, Vanilla HTML5/CSS3 SPA (Apple HIG)
- **Repo:** https://github.com/Muzaffarkhon/farovon-market-analysis
- **Ветка:** `main`, запуск: `npm start` или `npm run dev` (`node --watch src/server.js`)
- **Deploy:** Vercel serverless (`api/index.js` оборачивает Express, `vercel.json` rewrites → `/api`, регион `fra1`; миграции — `npm run vercel-build` → `src/db/migrateCli.js`) + Turso Cloud (AWS Frankfurt). Render.com (`https://farovon-market-analysis.onrender.com`) держится запасным на тот же Turso. UptimeRobot (`/health`).
- **НЕ ТРОГАТЬ:** `.env`, облачную БД Turso без бэкапа, учетку `admin`, 33 эндпоинта без проверки `auditFrontend.js`.
