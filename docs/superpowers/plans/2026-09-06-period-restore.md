# План: восстановление периода сбора

Спека: `docs/superpowers/specs/2026-09-06-period-restore-design.md`
Ветка: `claude/period-restore` (от `main` после мержа PR #64).

## Шаг 1 — фундамент: `is_active` + единая точка доступа

**Файлы:** `src/db/schema.sql`, `src/db/migrate.js`, `src/db/seed.js`, новый `src/services/periodService.js`, 15 call-sites.

1. `schema.sql`: в `CREATE TABLE periods` добавить `is_active INTEGER NOT NULL DEFAULT 0`.
2. `migrate.js` после блока годового архива:
   - `const addedIsActive = await ensureColumn('periods', 'is_active', 'INTEGER NOT NULL DEFAULT 0');`
   - `if (addedIsActive)` → `UPDATE periods SET is_active = 1 WHERE id = (SELECT id FROM periods ORDER BY id DESC LIMIT 1)`
   - страховка (всегда): активировать новейший, если активного нет вообще
3. `seed.js`: период создаётся с `is_active = 1` (в `INSERT OR REPLACE`).
4. Новый `src/services/periodService.js`:
   ```
   const { queryOne } = require('../db/database');
   async function getActivePeriod() {
     return (await queryOne('SELECT * FROM periods WHERE is_active = 1'))
         || (await queryOne('SELECT * FROM periods ORDER BY id DESC LIMIT 1'))
         || { id: null, name: 'Обзор рынка', state: 'открыт' };
   }
   module.exports = { getActivePeriod };
   ```
5. Заменить 15 «получить текущий период» call-sites на `getActivePeriod()` (см. список в спеке, раздел «Единая точка»). Где выбирались отдельные колонки — брать из полного объекта. `streamController.js:34` — поправить подзапрос на `WHERE is_active = 1`. `analyticsService.js:261` (список всех) — **не трогать**.

**Проверка шага:** `node --test` зелёный; `node -e "require('./src/db/migrate').migrate?.()"` не обязателен — миграция гоняется при старте. Запустить сервер локально из воркти с копией `.env`, `/health` отдаёт `schema` без ошибок, дашборд грузится.

**Коммит:** `feat(период): единая точка getActivePeriod + отметка is_active`

## Шаг 2 — операции над периодом

**Файлы:** `src/controllers/adminController.js` (`setPeriod`, `deletePeriod`, `listPeriodGrants`), `src/routes/api.js` при необходимости.

1. `setPeriod` — разветвить по `req.body.action`:
   - `close` → `UPDATE periods SET state='закрыт', updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE is_active=1`
   - `reopen` → то же со `state='открыт'`
   - `new` (требует `name`) → `batch([ снять is_active, INSERT ... is_active=1, state='открыт' ])`
   - `activate` (требует `id`) → валидировать существование строки; если она уже активна — вернуть `{ ok:true, already:true }`; иначе `batch([ снять is_active, UPDATE ... SET is_active=1, state='открыт', updated_by, updated_at WHERE id=? ])`
   - маппинг легаси-вызова без `action` (см. спеку) — для обратной совместимости
   - каждая ветка → своя запись в `audit_log`
   - ответ всегда `{ ok:true, period: <getActivePeriod() после операции, в формате как сейчас> }`
2. `deletePeriod` — guard `p.id != (самый новый)` → `p.is_active = 0`; текст ошибки «Активный период удалить нельзя».
3. `listPeriodGrants` — убрать фильтр `WHERE p.id != (самый новый)`, отдавать все периоды с `id, name, state, isActive, updatedAt, updatedBy, surveysCount` (сорт: активный первым, дальше по `id DESC`).

**Проверка шага:** новые юниты в `test/periodService.test.js` — фолбэк-цепочка `getActivePeriod` (мок `queryOne`), маппинг `action` (чистая функция-хелпер, вынести из `setPeriod`). Scratch-скрипт из спеки, сценарии 1–5, против живой БД на `ЭЭЭ_ТЕСТ_*`, с уборкой.

**Коммит:** `feat(период): close/reopen/new/activate + запрет удаления активного`

## Шаг 3 — фронт

**Файлы:** `public/app.js` (`renderAdminPeriod`, `renderPeriodsManageList`, обработчики), `public/app-core.js` (обёртки API).

1. `app-core.js`: `apiSetPeriod` принимает `{ action, name, id }`; добавить при необходимости узкие `apiPeriodActivate(id)`.
2. `renderAdminPeriod` (~7631): период закрыт → две кнопки:
   - «Открыть новый период» (как сейчас, `action:'new'` + запрос имени)
   - «Открыть закрытый обратно» (`action:'reopen'`, `ask()`: «Период "<имя>" снова станет открытым, сотрудники смогут вносить данные»)
   период открыт → кнопка «Закрыть период сбора» (`action:'close'`)
3. `renderPeriodsManageList` (~7759): заголовок «Все периоды сбора». Колонки: Период (имя + дата), Статус, Анкет, действие.
   - `isActive` → бейдж «Активен», кнопок активации нет; «Удалить» скрыта
   - не активный → кнопка «Сделать активным снова» (`ask()`: «Текущим станет период "<имя>". Сотрудники снова смогут вносить данные за этот год.») → `apiSetPeriod({action:'activate', id})` → `renderAdminPeriod()` + `toast`
   - «Удалить» — только не активный с 0 анкет (как сейчас)
4. После любой операции — перерисовать вкладку. `liveRefresh.js` уже обновит остальных (SSE-подпись включает активный период).

**Проверка шага:** прокликать в браузере из воркти (`npm run dev`, копия `.env`):
- закрыть период → появились две кнопки → «Открыть закрытый обратно» → статус «открыт», данные на месте
- «Открыть новый период» → список показывает старый неактивным, новый активным
- «Сделать активным снова» на старый → вернулся, дашборд/форма показывают его анкеты
- скриншоты до/после в ответ пользователю

**Коммит:** `feat(период): кнопки «Открыть закрытый обратно» и «Сделать активным снова»`

## Шаг 4 — сборка проверки и PR

1. Прогнать весь `node --test`.
2. Финальный scratch-прогон всех сценариев спеки, показать вывод.
3. Обновить `docs/superpowers/plans/2026-09-06-archive-edit-access-checklist.md`-стиль чек-лист ручной проверки, если нужен.
4. Открыть PR `claude/period-restore` → `main`, дождаться CI.
5. Пользователь мержит; ветку удаляет он же (классификатор блокирует и merge, и delete).

## Риски / на что смотреть

- **Гонка активного периода** между вкладками — `batch` атомарен; хуже чем «активен последний из двух» не будет.
- **`getActivePeriod` в горячем пути** (`authController`, `dashboardController`) — лишний `queryOne`. Сейчас там уже такой же одиночный запрос, регресса нет. Если понадобится — обернуть в существующий `cached()` с коротким TTL (как `getPeriodInfo`).
- **`period_id` у анкет уже проставлен** миграцией PR #64 (на старейший период для легаси). Активация периода не трогает `surveys.period_id` — только `periods.is_active`. Данные периода видны, потому что фильтры по `period_id` начинают резолвить его как активный.
- **Легаси-вызовы `apiSetPeriod`** из возможных сторонних мест (телеграм-бот?) — проверить grep `apiSetPeriod` / `/admin/period` перед правкой контракта.
