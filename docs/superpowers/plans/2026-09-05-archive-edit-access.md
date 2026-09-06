# Точечный доступ к редактированию архивного года — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать админу выдавать конкретному сотруднику временный (24ч) доступ на редактирование данных по рынку (Шаг 2 «Данные по рынку») за конкретный уже закрытый год сбора, не открывая редактирование всем и не трогая текущий год.

**Architecture:** Новая таблица `period_edit_grants` (кто/на какой год/до какого времени). Единая точка проверки — `src/services/periodAccessService.js`: чистая функция `isGrantActive` + асинхронная `resolveEditablePeriod(requestedPeriodId, user)`, которая решает «текущий год — можно всем как сейчас; архивный — можно admin всегда, иначе только по живому гранту». Эта же функция стоит и на сохранении (`saveSurveyDetails`), и на новом эндпоинте чтения архивных анкет (`/api/survey/for-period`). На фронте: маленький баннер-переключатель прямо на форме подразделения (Шаг 2), появляющийся только если у пользователя есть хоть один активный грант; при архивном режиме Шаг 1 (конкуренты) скрывается — он не привязан к году в принципе (см. предыдущую задачу, «не цель»).

**Tech Stack:** Node.js + Express, `@libsql/client` (Turso, сырой SQL), ванильный JS на фронте (`public/app.js`/`app-core.js`, без сборки), `node --test`.

**Spec:** [docs/superpowers/specs/2026-09-05-archive-edit-access-design.md](../specs/2026-09-05-archive-edit-access-design.md) (опирается на [docs/superpowers/specs/2026-09-04-yearly-archive-design.md](../specs/2026-09-04-yearly-archive-design.md) — годовой архив, уже реализован)

## Global Constraints

- Грант — конкретному человеку (по `login`) на конкретный год, не роли целиком и не «на все прошлые годы разом».
- Срок гранта фиксирован — 24 часа от момента выдачи, без настройки админом. Повторная выдача тому же человеку на тот же год продлевает срок заново (не создаёт вторую запись — `UNIQUE(user_login, period_id)`).
- `admin` может редактировать любой архивный год всегда, без гранта и без проверки. Все остальные роли (включая `hrbp`, у которого и так есть `period:edit`) — только по живому гранту.
- Грант расширяет «какой год», а не «какие подразделения» — обычные ограничения по `users.units`/`hrbp` продолжают действовать как для текущего периода.
- Список компаний-конкурентов (`competitors`, Шаг 1 «Участники рынка») НЕ привязан к году в принципе (см. предыдущую спеку, раздел «не цель») — в архивном режиме редактирования Шаг 1 недоступен вообще, редактируется только Шаг 2 («Данные по рынку», таблица `surveys`).
- Выдача/отзыв гранта защищены тем же правом `period:edit`, что и открытие/закрытие периода (`src/routes/api.js:102`, `requireCapability('period:edit')`).
- Ничего не удаляется физически из просроченных грантов — они просто перестают давать доступ (`expires_at > CURRENT_TIMESTAMP` в каждом запросе), остаются как история для аудита.
- Проект без тестовой БД — `src/db/database.js` всегда подключается к живой Turso. Проверка кода, трогающего БД, идёт через одноразовые скрипты в `scratch/` (гитигнорится) с явно помеченными тестовыми строками, удаляемыми в `finally`.

## Environment Setup Note

Работа идёт в git worktree (`.claude/worktrees/sync-data-laptops-9a0bb7`) — там нет файла `.env`. Для любого шага, где нужно подключиться к реальной базе, копировать его из основной папки:

```bash
cp "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis/.env" .env
```

(гитигнорится, в коммит не попадёт). Живая база общая для двух ноутбуков пользователя — тестовые данные всегда с явным тегом (например `'ЭЭЭ_ТЕСТ_...'`), удалять в `finally`.

---

### Task 1: Схема — таблица `period_edit_grants`

**Files:**
- Modify: `src/db/schema.sql` (добавить `CREATE TABLE` рядом с `periods`)
- Modify: `src/db/migrate.js` (идемпотентная миграция)
- Create: `scratch/verify_task1_grants_table.js` (одноразово)

**Interfaces:**
- Produces: таблица `period_edit_grants(id, user_login, period_id, granted_by, granted_at, expires_at)` с `UNIQUE(user_login, period_id)`.

- [ ] **Step 1: Добавить таблицу в `schema.sql`**

В `src/db/schema.sql`, сразу после блока `CREATE TABLE IF NOT EXISTS periods (...)` (строка ~111), добавить:

```sql
CREATE TABLE IF NOT EXISTS period_edit_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_login TEXT NOT NULL,
  period_id INTEGER NOT NULL REFERENCES periods(id),
  granted_by TEXT NOT NULL,
  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  UNIQUE(user_login, period_id)
);
```

- [ ] **Step 2: Добавить миграцию**

В `src/db/migrate.js`, в конец функции `migrate()` (перед финальным `console.log('🔧 Миграция: таблицы бенчмаркинга...')`), добавить:

```javascript
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
```

- [ ] **Step 3: Скрипт проверки**

Создать `scratch/verify_task1_grants_table.js`:

```javascript
'use strict';
// Разовая проверка Задачи 1. Запуск: node scratch/verify_task1_grants_table.js

const { queryAll, run } = require('../src/db/database');
const { migrate } = require('../src/db/migrate');

(async () => {
  await migrate();
  await migrate(); // второй прогон — должен быть идемпотентным, без ошибок

  const cols = await queryAll('PRAGMA table_info(period_edit_grants)');
  const names = cols.map(c => c.name).sort();
  const expected = ['expires_at', 'granted_at', 'granted_by', 'id', 'period_id', 'user_login'].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error('FAIL: неверный набор колонок: ' + JSON.stringify(names));
  }

  // UNIQUE(user_login, period_id) — вторая вставка той же пары должна упасть.
  const anyPeriod = await queryAll('SELECT id FROM periods ORDER BY id ASC LIMIT 1');
  if (!anyPeriod.length) throw new Error('FAIL: нет ни одного периода в базе — тест невозможен');
  const pid = anyPeriod[0].id;

  try {
    await run(
      "INSERT INTO period_edit_grants (user_login, period_id, granted_by, expires_at) VALUES ('ЭЭЭ_ТЕСТ_grants_qa', ?, 'qa', datetime('now', '+1 day'))",
      [pid]
    );
    let dupFailed = false;
    try {
      await run(
        "INSERT INTO period_edit_grants (user_login, period_id, granted_by, expires_at) VALUES ('ЭЭЭ_ТЕСТ_grants_qa', ?, 'qa', datetime('now', '+1 day'))",
        [pid]
      );
    } catch (e) {
      dupFailed = true;
    }
    if (!dupFailed) throw new Error('FAIL: UNIQUE(user_login, period_id) не сработал — дубликат вставился');
    console.log('OK: таблица period_edit_grants создана, UNIQUE(user_login, period_id) работает');
  } finally {
    await run("DELETE FROM period_edit_grants WHERE user_login = 'ЭЭЭ_ТЕСТ_grants_qa'");
  }
  process.exit(0);
})().catch(err => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 4: Запустить и прибрать**

```bash
cd "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis" && node scratch/verify_task1_grants_table.js
```

Ожидается: `OK: таблица period_edit_grants создана, UNIQUE(user_login, period_id) работает`.

```bash
rm scratch/verify_task1_grants_table.js
git add src/db/schema.sql src/db/migrate.js
git commit -m "feat(бд): таблица period_edit_grants для точечного доступа к архиву

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `periodAccessService.js` — единая проверка доступа

**Files:**
- Create: `src/services/periodAccessService.js`
- Create: `test/periodAccessService.test.js`
- Create: `scratch/verify_task2_resolve_period.js` (одноразово)

**Interfaces:**
- Produces: `isGrantActive(expiresAt, nowIso)` (чистая функция) и `async resolveEditablePeriod(requestedPeriodId, user)` — оба экспортируются. `resolveEditablePeriod` возвращает `{ ok: true, period: { id, state, name } }` либо `{ ok: false, status: number, error: string }`.
- Consumes: `queryOne`, `queryAll` из `../db/database`.

- [ ] **Step 1: Написать `isGrantActive` и тест на неё**

Создать `test/periodAccessService.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isGrantActive } = require('../src/services/periodAccessService');

test('isGrantActive: срок ещё не истёк → true', () => {
  assert.equal(isGrantActive('2026-09-06T10:00:00.000Z', '2026-09-06T09:00:00.000Z'), true);
});

test('isGrantActive: срок истёк → false', () => {
  assert.equal(isGrantActive('2026-09-06T08:00:00.000Z', '2026-09-06T09:00:00.000Z'), false);
});

test('isGrantActive: ровно в момент истечения → false (не включительно)', () => {
  assert.equal(isGrantActive('2026-09-06T09:00:00.000Z', '2026-09-06T09:00:00.000Z'), false);
});

test('isGrantActive: нет записи (null/undefined) → false', () => {
  assert.equal(isGrantActive(null, '2026-09-06T09:00:00.000Z'), false);
  assert.equal(isGrantActive(undefined, '2026-09-06T09:00:00.000Z'), false);
});
```

Создать `src/services/periodAccessService.js`:

```javascript
'use strict';

const { queryOne } = require('../db/database');

/**
 * Активен ли грант с таким сроком истечения на момент `nowIso`. Чистая
 * функция ради тестируемости без обращения к БД — реальный текущий момент
 * передаётся явно вызывающим кодом (`new Date().toISOString()`).
 */
function isGrantActive(expiresAt, nowIso) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() > new Date(nowIso).getTime();
}

/**
 * Решает, какой период редактировать, и имеет ли пользователь на это право.
 *
 * - Не передан periodId (или передан id последнего периода) → текущий год,
 *   доступен как обычно (без проверки гранта — это не архив).
 * - Передан id архивного (не последнего) периода:
 *   - admin → разрешено всегда, без гранта;
 *   - иначе → только если в period_edit_grants есть живая (не истёкшая)
 *     запись на этого user_login + этот periodId.
 *
 * См. docs/superpowers/specs/2026-09-05-archive-edit-access-design.md.
 *
 * @param {string|number|null|undefined} requestedPeriodId
 * @param {{ role: string, login: string }} user
 * @returns {Promise<{ok:true, period:{id:number|null,state:string,name:string}} | {ok:false,status:number,error:string}>}
 */
async function resolveEditablePeriod(requestedPeriodId, user) {
  const latest = (await queryOne('SELECT id, state, name FROM periods ORDER BY id DESC LIMIT 1'))
    || { id: null, state: 'открыт', name: 'Обзор рынка' };

  const requested = (requestedPeriodId === null || requestedPeriodId === undefined || requestedPeriodId === '')
    ? null
    : Number(requestedPeriodId);

  if (requested === null || requested === latest.id) {
    return { ok: true, period: latest };
  }

  // Архивный период — целевой периода должен реально существовать.
  const target = await queryOne('SELECT id, state, name FROM periods WHERE id = ?', [requested]);
  if (!target) {
    return { ok: false, status: 404, error: 'Период не найден' };
  }

  if (user.role === 'admin') {
    return { ok: true, period: target };
  }

  const grant = await queryOne(
    'SELECT expires_at FROM period_edit_grants WHERE user_login = ? AND period_id = ?',
    [user.login, requested]
  );
  if (!grant || !isGrantActive(grant.expires_at, new Date().toISOString())) {
    return { ok: false, status: 403, error: 'Нет доступа к редактированию этого периода' };
  }

  return { ok: true, period: target };
}

module.exports = { isGrantActive, resolveEditablePeriod };
```

- [ ] **Step 2: Запустить unit-тесты**

```bash
cd "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis" && node --test test/periodAccessService.test.js
```

Ожидается: все 4 теста PASS.

- [ ] **Step 3: Скрипт проверки `resolveEditablePeriod` на живой БД**

Создать `scratch/verify_task2_resolve_period.js`:

```javascript
'use strict';
// Разовая проверка Задачи 2. Запуск: node scratch/verify_task2_resolve_period.js

const assert = require('node:assert/strict');
const { queryOne, run } = require('../src/db/database');
const { resolveEditablePeriod } = require('../src/services/periodAccessService');

const TEST_LOGIN = 'ЭЭЭ_ТЕСТ_resolve_qa';

(async () => {
  const latest = await queryOne('SELECT id FROM periods ORDER BY id DESC LIMIT 1');
  const oldest = await queryOne('SELECT id FROM periods ORDER BY id ASC LIMIT 1');
  if (!latest || !oldest || latest.id === oldest.id) {
    throw new Error('FAIL: нужно хотя бы 2 разных периода в базе для этого теста');
  }

  // 1. Без periodId → текущий (латест), без проверки гранта.
  const r1 = await resolveEditablePeriod(undefined, { role: 'user', login: TEST_LOGIN });
  assert.equal(r1.ok, true);
  assert.equal(r1.period.id, latest.id);

  // 2. Явно latest.id → тоже текущий, без проверки гранта.
  const r2 = await resolveEditablePeriod(latest.id, { role: 'user', login: TEST_LOGIN });
  assert.equal(r2.ok, true);
  assert.equal(r2.period.id, latest.id);

  // 3. Архивный период, обычная роль, гранта нет → 403.
  const r3 = await resolveEditablePeriod(oldest.id, { role: 'user', login: TEST_LOGIN });
  assert.equal(r3.ok, false);
  assert.equal(r3.status, 403);

  // 4. Архивный период, роль admin, гранта нет → разрешено.
  const r4 = await resolveEditablePeriod(oldest.id, { role: 'admin', login: TEST_LOGIN });
  assert.equal(r4.ok, true);
  assert.equal(r4.period.id, oldest.id);

  // 5. Архивный период, живой грант → разрешено.
  await run(
    "INSERT INTO period_edit_grants (user_login, period_id, granted_by, expires_at) VALUES (?, ?, 'qa', datetime('now', '+1 day'))",
    [TEST_LOGIN, oldest.id]
  );
  try {
    const r5 = await resolveEditablePeriod(oldest.id, { role: 'user', login: TEST_LOGIN });
    assert.equal(r5.ok, true);
    assert.equal(r5.period.id, oldest.id);

    // 6. Тот же грант, но истёкший → снова 403.
    await run(
      "UPDATE period_edit_grants SET expires_at = datetime('now', '-1 hour') WHERE user_login = ? AND period_id = ?",
      [TEST_LOGIN, oldest.id]
    );
    const r6 = await resolveEditablePeriod(oldest.id, { role: 'user', login: TEST_LOGIN });
    assert.equal(r6.ok, false);
    assert.equal(r6.status, 403);

    console.log('OK: resolveEditablePeriod — все 6 сценариев корректны');
  } finally {
    await run('DELETE FROM period_edit_grants WHERE user_login = ?', [TEST_LOGIN]);
  }
  process.exit(0);
})().catch(err => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 4: Запустить проверку**

```bash
cd "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis" && node scratch/verify_task2_resolve_period.js
```

Если в реальной базе только ОДИН период (а не два) — скрипт сам упадёт с понятным сообщением `нужно хотя бы 2 разных периода в базе` (это нормально на данный момент, годовой архив из прошлой задачи ещё не создавал второго периода в проде). В этом случае: временно вставить второй тестовый период прямо в скрипте перед проверкой (```INSERT INTO periods (name, state, updated_by) VALUES ('ЭЭЭ_ТЕСТ_period_qa', 'закрыт', 'qa')```), запомнить его id, использовать вместо `oldest`, и удалить его в `finally` вместе с грантом. Внести эту правку в скрипт при необходимости — сути проверки это не меняет.

- [ ] **Step 5: Прибрать и закоммитить**

```bash
rm scratch/verify_task2_resolve_period.js
git add src/services/periodAccessService.js test/periodAccessService.test.js
git commit -m "feat(доступ): periodAccessService — единая проверка доступа к архивному году

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `saveSurveyDetails` принимает `periodId` и использует `resolveEditablePeriod`

**Files:**
- Modify: `src/controllers/surveyController.js`
- Create: `scratch/verify_task3_save_archive.js`

**Interfaces:**
- Consumes: `resolveEditablePeriod` (Task 2).
- Produces: `POST /survey/save-details` принимает необязательное поле `periodId` в теле; при архивном `periodId` без доступа возвращает `403 {error:'Нет доступа к редактированию этого периода'}`.

- [ ] **Step 1: Импортировать `resolveEditablePeriod`**

В начале `src/controllers/surveyController.js`, рядом с `const { queryOne, queryAll, run, batch } = require('../db/database');` (строка 2), добавить:

```javascript
const { resolveEditablePeriod } = require('../services/periodAccessService');
```

- [ ] **Step 2: Заменить резолвинг периода**

В `exports.saveSurveyDetails`, найти (текущая сигнатура — строка 249, деструктуризация тела запроса):

```javascript
exports.saveSurveyDetails = async (req, res) => {
  const { unit, upsert, remove, groupKey } = req.body;
```

заменить на:

```javascript
exports.saveSurveyDetails = async (req, res) => {
  const { unit, upsert, remove, groupKey, periodId } = req.body;
```

Затем найти (строки 330-334):

```javascript
  try {
    const period = (await queryOne('SELECT id, state, name FROM periods ORDER BY id DESC LIMIT 1')) || { id: null, state: 'открыт', name: 'Обзор рынка' };
    if (period.state === 'закрыт' && req.user.role !== 'hrbp' && req.user.role !== 'admin' && req.user.role !== 'cb') {
      return res.status(403).json({ ok: false, error: 'Период сбора данных закрыт' });
    }
```

заменить на:

```javascript
  try {
    const resolved = await resolveEditablePeriod(periodId, req.user);
    if (!resolved.ok) {
      return res.status(resolved.status).json({ ok: false, error: resolved.error });
    }
    const period = resolved.period;
    // Проверка «период закрыт → только элевейтед-роли» имеет смысл ТОЛЬКО
    // для текущего (последнего) периода — это временное состояние между
    // закрытием и открытием следующего года. Для архивного периода admin
    // уже разрешён resolveEditablePeriod безусловно, а для остальных ролей
    // единственный путь сюда — живой грант, который сам по себе достаточное
    // разрешение (иначе грант никогда бы не сработал ни для кого, кроме
    // hrbp/admin/cb, что противоречит всей цели этой задачи).
    const latestRow = await queryOne('SELECT id, state FROM periods ORDER BY id DESC LIMIT 1');
    const isCurrentPeriod = !latestRow || period.id === latestRow.id;
    if (isCurrentPeriod && period.state === 'закрыт' && req.user.role !== 'hrbp' && req.user.role !== 'admin' && req.user.role !== 'cb') {
      return res.status(403).json({ ok: false, error: 'Период сбора данных закрыт' });
    }
```

Всё остальное тело функции (смежная группа, обычная ветка, `period.id`/`period.name` в INSERT/UPDATE) не меняется — оно уже использует переменную `period` ровно так же, как раньше.

- [ ] **Step 3: Скрипт проверки — сохранение в архивный год через реальную функцию**

Создать `scratch/verify_task3_save_archive.js`:

```javascript
'use strict';
// Разовая проверка Задачи 3. Запуск: node scratch/verify_task3_save_archive.js
// Вызывает exports.saveSurveyDetails напрямую (без HTTP) с поддельными
// req/res, на тестовом архивном периоде с живым грантом.

const assert = require('node:assert/strict');
const { queryOne, queryAll, run } = require('../src/db/database');
const surveyController = require('../src/controllers/surveyController');

const TEST_LOGIN = 'ЭЭЭ_ТЕСТ_savearchive_qa';
const TEST_UNIT = 'ЭЭЭ_ТЕСТ_savearchive_unit';

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

(async () => {
  const archived = await run(
    "INSERT INTO periods (name, state, updated_by) VALUES ('ЭЭЭ_ТЕСТ_period_savearchive', 'закрыт', 'qa')"
  );
  const archivedId = Number(archived.lastInsertRowid);

  try {
    // Без гранта — должен получить 403.
    const reqNoGrant = {
      body: { unit: TEST_UNIT, upsert: [{ company: 'ТЕСТ Компания', posOur: 'ТЕСТ Должность', payFrom: 1000, payTo: 2000 }], periodId: archivedId },
      user: { role: 'user', login: TEST_LOGIN, fio: 'ТЕСТ Тестов', units: [TEST_UNIT] }
    };
    const resNoGrant = fakeRes();
    await surveyController.saveSurveyDetails(reqNoGrant, resNoGrant);
    assert.equal(resNoGrant.statusCode, 403, 'ожидался 403 без гранта, получено: ' + resNoGrant.statusCode);

    // Выдаём грант — теперь должно пройти и создать строку с этим period_id.
    await run(
      "INSERT INTO period_edit_grants (user_login, period_id, granted_by, expires_at) VALUES (?, ?, 'qa', datetime('now', '+1 day'))",
      [TEST_LOGIN, archivedId]
    );
    const reqWithGrant = {
      body: { unit: TEST_UNIT, upsert: [{ company: 'ТЕСТ Компания', posOur: 'ТЕСТ Должность', payFrom: 1000, payTo: 2000 }], periodId: archivedId },
      user: { role: 'user', login: TEST_LOGIN, fio: 'ТЕСТ Тестов', units: [TEST_UNIT] }
    };
    const resWithGrant = fakeRes();
    await surveyController.saveSurveyDetails(reqWithGrant, resWithGrant);
    assert.equal(resWithGrant.statusCode, 200, 'ожидался 200 с грантом, получено: ' + resWithGrant.statusCode + ' ' + JSON.stringify(resWithGrant.body));
    assert.equal(resWithGrant.body.ok, true);

    const saved = await queryAll("SELECT period_id FROM surveys WHERE unit = ? AND state = 'активна'", [TEST_UNIT]);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].period_id, archivedId, 'строка должна быть сохранена именно в архивный period_id');

    console.log('OK: без гранта 403, с грантом сохранение уходит в архивный period_id');
  } finally {
    await run('DELETE FROM surveys WHERE unit = ?', [TEST_UNIT]);
    await run('DELETE FROM period_edit_grants WHERE user_login = ?', [TEST_LOGIN]);
    await run('DELETE FROM periods WHERE id = ?', [archivedId]);
  }
  process.exit(0);
})().catch(err => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 4: Запустить проверку**

```bash
cd "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis" && node scratch/verify_task3_save_archive.js
```

Ожидается: `OK: без гранта 403, с грантом сохранение уходит в архивный period_id`.

- [ ] **Step 5: Прибрать и закоммитить**

```bash
rm scratch/verify_task3_save_archive.js
git add src/controllers/surveyController.js
git commit -m "feat(анкета): сохранение в архивный год — только с живым грантом

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Новый эндпоинт чтения — `POST /api/survey/for-period`

**Files:**
- Modify: `src/controllers/surveyController.js` (новый экспорт)
- Modify: `src/routes/api.js`
- Create: `scratch/verify_task4_for_period.js`

**Interfaces:**
- Consumes: `resolveEditablePeriod` (Task 2).
- Produces: `exports.getSurveysForPeriod` в `surveyController.js`; маршрут `POST /survey/for-period`.

- [ ] **Step 1: Добавить контроллер**

В `src/controllers/surveyController.js`, в конец файла (после `exports.addDictionaryItem`), добавить:

```javascript
/**
 * Анкеты подразделения за КОНКРЕТНЫЙ год — используется формой заполнения,
 * когда человек с активным грантом переключается на архивный год (см.
 * docs/superpowers/specs/2026-09-05-archive-edit-access-design.md). Та же
 * проверка доступа, что и на сохранении — resolveEditablePeriod.
 */
exports.getSurveysForPeriod = async (req, res) => {
  const { unit, periodId } = req.body;
  if (!unit || !String(unit).trim()) {
    return res.status(400).json({ ok: false, error: 'Не указано подразделение' });
  }

  try {
    const resolved = await resolveEditablePeriod(periodId, req.user);
    if (!resolved.ok) {
      return res.status(resolved.status).json({ ok: false, error: resolved.error });
    }

    const surveys = await queryAll(
      "SELECT * FROM surveys WHERE unit = ? AND state != 'удалена' AND period_id = ?",
      [String(unit).trim(), resolved.period.id]
    );

    res.json({ ok: true, surveys });
  } catch (err) {
    console.error('getSurveysForPeriod error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка загрузки анкет за период' });
  }
};
```

- [ ] **Step 2: Добавить маршрут**

В `src/routes/api.js`, рядом со строкой 65 (`router.post('/survey/save-details', surveyController.saveSurveyDetails);`), добавить сразу после:

```javascript
router.post('/survey/for-period', surveyController.getSurveysForPeriod);
```

(Без отдельного `requireCapability` — доступ целиком регулирует `resolveEditablePeriod` внутри контроллера, как и у `saveSurveyDetails` на той же строке рядом, которая тоже не имеет отдельного `requireCapability`.)

- [ ] **Step 3: Скрипт проверки**

Создать `scratch/verify_task4_for_period.js`:

```javascript
'use strict';
// Разовая проверка Задачи 4. Запуск: node scratch/verify_task4_for_period.js

const assert = require('node:assert/strict');
const { run } = require('../src/db/database');
const surveyController = require('../src/controllers/surveyController');

const TEST_LOGIN = 'ЭЭЭ_ТЕСТ_forperiod_qa';
const TEST_UNIT = 'ЭЭЭ_ТЕСТ_forperiod_unit';
const TEST_SID = 'ЭЭЭ_ТЕСТ_sid_forperiod_qa';

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

(async () => {
  const archived = await run(
    "INSERT INTO periods (name, state, updated_by) VALUES ('ЭЭЭ_ТЕСТ_period_forperiod', 'закрыт', 'qa')"
  );
  const archivedId = Number(archived.lastInsertRowid);

  try {
    await run(
      `INSERT INTO surveys (sid, unit, company, pos_our, pay_from, pay_to, cur, pay_per, created_by, created_at, state, period, period_id)
       VALUES (?, ?, 'ТЕСТ Компания', 'ТЕСТ Должность', 3000, 4000, 'сомони', 'в месяц', 'qa', CURRENT_TIMESTAMP, 'активна', 'ЭЭЭ_ТЕСТ_period_forperiod', ?)`,
      [TEST_SID, TEST_UNIT, archivedId]
    );

    // Без гранта — 403, данные не отдаются.
    const resNoGrant = fakeRes();
    await surveyController.getSurveysForPeriod(
      { body: { unit: TEST_UNIT, periodId: archivedId }, user: { role: 'user', login: TEST_LOGIN } },
      resNoGrant
    );
    assert.equal(resNoGrant.statusCode, 403);

    // С грантом — отдаёт ровно ту одну строку.
    await run(
      "INSERT INTO period_edit_grants (user_login, period_id, granted_by, expires_at) VALUES (?, ?, 'qa', datetime('now', '+1 day'))",
      [TEST_LOGIN, archivedId]
    );
    const resWithGrant = fakeRes();
    await surveyController.getSurveysForPeriod(
      { body: { unit: TEST_UNIT, periodId: archivedId }, user: { role: 'user', login: TEST_LOGIN } },
      resWithGrant
    );
    assert.equal(resWithGrant.statusCode, 200);
    assert.equal(resWithGrant.body.ok, true);
    assert.equal(resWithGrant.body.surveys.length, 1);
    assert.equal(resWithGrant.body.surveys[0].sid, TEST_SID);

    console.log('OK: getSurveysForPeriod — без гранта 403, с грантом отдаёт архивные строки');
  } finally {
    await run('DELETE FROM surveys WHERE sid = ?', [TEST_SID]);
    await run('DELETE FROM period_edit_grants WHERE user_login = ?', [TEST_LOGIN]);
    await run('DELETE FROM periods WHERE id = ?', [archivedId]);
  }
  process.exit(0);
})().catch(err => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 4: Запустить проверку**

```bash
cd "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis" && node scratch/verify_task4_for_period.js
```

Ожидается: `OK: getSurveysForPeriod — без гранта 403, с грантом отдаёт архивные строки`.

- [ ] **Step 5: Прибрать и закоммитить**

```bash
rm scratch/verify_task4_for_period.js
git add src/controllers/surveyController.js src/routes/api.js
git commit -m "feat(анкета): эндпоинт чтения анкет подразделения за архивный год

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Админские эндпоинты — выдача/отзыв/список грантов

**Files:**
- Modify: `src/controllers/adminController.js` (новые экспорты)
- Modify: `src/routes/api.js`
- Create: `scratch/verify_task5_admin_grants.js`

**Interfaces:**
- Produces: `exports.grantPeriodEdit`, `exports.revokePeriodEdit`, `exports.listPeriodGrants` в `adminController.js`; маршруты `POST /admin/period-grants`, `POST /admin/period-grants/revoke`, `GET /admin/period-grants`, все под `requireCapability('period:edit')`.

- [ ] **Step 1: Добавить контроллеры**

В `src/controllers/adminController.js`, сразу после существующей `exports.setPeriod` (после её закрывающей `};`, то есть после блока, заканчивающегося строкой ~817 `}`), добавить:

```javascript
// ─── Точечный доступ к редактированию архивного года ───
// См. docs/superpowers/specs/2026-09-05-archive-edit-access-design.md.
// Выдача — INSERT ... ON CONFLICT DO UPDATE: повторная выдача тому же
// человеку на тот же год продлевает 24 часа заново, а не плодит дубликаты
// (UNIQUE(user_login, period_id) из миграции).
exports.grantPeriodEdit = async (req, res) => {
  const userLogin = String(req.body.userLogin || '').trim();
  const periodId = Number(req.body.periodId);

  if (!userLogin) {
    return res.status(400).json({ ok: false, error: 'Не указан сотрудник' });
  }
  if (!Number.isFinite(periodId)) {
    return res.status(400).json({ ok: false, error: 'Не указан период' });
  }

  try {
    const period = await queryOne('SELECT id, name FROM periods WHERE id = ?', [periodId]);
    if (!period) {
      return res.status(404).json({ ok: false, error: 'Период не найден' });
    }
    const latest = await queryOne('SELECT id FROM periods ORDER BY id DESC LIMIT 1');
    if (latest && latest.id === periodId) {
      return res.status(400).json({ ok: false, error: 'Текущий период редактируется без гранта' });
    }

    await run(`
      INSERT INTO period_edit_grants (user_login, period_id, granted_by, granted_at, expires_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, datetime('now', '+1 day'))
      ON CONFLICT(user_login, period_id) DO UPDATE SET
        granted_by = excluded.granted_by,
        granted_at = CURRENT_TIMESTAMP,
        expires_at = excluded.expires_at
    `, [userLogin, periodId, req.user.fio || req.user.login]);

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'выдан доступ к архивному периоду',
      `Сотрудник: ${userLogin}, период: ${period.name}, на 24ч`
    ]);

    res.json({ ok: true });
  } catch (err) {
    console.error('grantPeriodEdit error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка выдачи доступа' });
  }
};

exports.revokePeriodEdit = async (req, res) => {
  const userLogin = String(req.body.userLogin || '').trim();
  const periodId = Number(req.body.periodId);

  if (!userLogin || !Number.isFinite(periodId)) {
    return res.status(400).json({ ok: false, error: 'Не указан сотрудник или период' });
  }

  try {
    await run('DELETE FROM period_edit_grants WHERE user_login = ? AND period_id = ?', [userLogin, periodId]);

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'отозван доступ к архивному периоду',
      `Сотрудник: ${userLogin}, период id: ${periodId}`
    ]);

    res.json({ ok: true });
  } catch (err) {
    console.error('revokePeriodEdit error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка отзыва доступа' });
  }
};

exports.listPeriodGrants = async (req, res) => {
  try {
    const [grants, periods] = await Promise.all([
      queryAll(`
        SELECT g.user_login AS "userLogin", COALESCE(u.fio, g.user_login) AS "userFio",
               g.period_id AS "periodId", p.name AS "periodName",
               g.granted_by AS "grantedBy", g.granted_at AS "grantedAt", g.expires_at AS "expiresAt"
        FROM period_edit_grants g
        JOIN periods p ON p.id = g.period_id
        LEFT JOIN users u ON u.login = g.user_login
        WHERE g.expires_at > CURRENT_TIMESTAMP
        ORDER BY g.expires_at DESC
      `),
      queryAll(`
        SELECT id, name FROM periods
        WHERE id != (SELECT id FROM periods ORDER BY id DESC LIMIT 1)
        ORDER BY id DESC
      `)
    ]);

    res.json({ ok: true, grants, periods });
  } catch (err) {
    console.error('listPeriodGrants error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка загрузки списка доступов' });
  }
};
```

Проверить, что `queryOne`, `queryAll`, `run` уже импортированы в начале `adminController.js` (используются другими экспортами файла) — если нет, добавить в существующую строку импорта из `../db/database`.

- [ ] **Step 2: Добавить маршруты**

В `src/routes/api.js`, сразу после строки 102 (`router.post('/admin/period', requireCapability('period:edit'), adminController.setPeriod);`), добавить:

```javascript
router.post('/admin/period-grants', requireCapability('period:edit'), adminController.grantPeriodEdit);
router.post('/admin/period-grants/revoke', requireCapability('period:edit'), adminController.revokePeriodEdit);
router.get('/admin/period-grants', requireCapability('period:edit'), adminController.listPeriodGrants);
router.get('/admin/period-grants/users', requireCapability('period:edit'), adminController.getUsers);
```

(Последняя строка переиспользует уже существующий `adminController.getUsers` — обычно защищён `users:view`, которого у `hrbp` нет по умолчанию (`src/config/capabilities.js:52`), а `period:edit` у `hrbp` есть. Тот же контроллер, только для этого экрана доступен по праву `period:edit`, чтобы не заставлять давать `hrbp` лишнее право только ради пикера сотрудника в этом одном месте.)

- [ ] **Step 3: Скрипт проверки**

Создать `scratch/verify_task5_admin_grants.js`:

```javascript
'use strict';
// Разовая проверка Задачи 5. Запуск: node scratch/verify_task5_admin_grants.js

const assert = require('node:assert/strict');
const { queryOne, queryAll, run } = require('../src/db/database');
const adminController = require('../src/controllers/adminController');

const TEST_LOGIN = 'ЭЭЭ_ТЕСТ_admingrants_qa';

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

(async () => {
  const archived = await run(
    "INSERT INTO periods (name, state, updated_by) VALUES ('ЭЭЭ_ТЕСТ_period_admingrants', 'закрыт', 'qa')"
  );
  const archivedId = Number(archived.lastInsertRowid);
  const adminUser = { role: 'admin', login: 'qa_admin', fio: 'QA Admin' };

  try {
    // Выдать грант.
    const resGrant = fakeRes();
    await adminController.grantPeriodEdit(
      { body: { userLogin: TEST_LOGIN, periodId: archivedId }, user: adminUser },
      resGrant
    );
    assert.equal(resGrant.statusCode, 200, JSON.stringify(resGrant.body));

    const row1 = await queryOne('SELECT expires_at FROM period_edit_grants WHERE user_login = ? AND period_id = ?', [TEST_LOGIN, archivedId]);
    assert.ok(row1, 'грант должен быть создан');

    // Повторная выдача — продлевает, не дублирует.
    const resGrant2 = fakeRes();
    await adminController.grantPeriodEdit(
      { body: { userLogin: TEST_LOGIN, periodId: archivedId }, user: adminUser },
      resGrant2
    );
    assert.equal(resGrant2.statusCode, 200);
    const countRows = await queryAll('SELECT COUNT(*) AS n FROM period_edit_grants WHERE user_login = ? AND period_id = ?', [TEST_LOGIN, archivedId]);
    assert.equal(Number(countRows[0].n), 1, 'повторная выдача не должна плодить дубликаты');

    // Список — грант виден, целевой period_id есть в periods (архивных).
    const resList = fakeRes();
    await adminController.listPeriodGrants({}, resList);
    assert.equal(resList.statusCode, 200);
    const found = (resList.body.grants || []).find(g => g.userLogin === TEST_LOGIN && g.periodId === archivedId);
    assert.ok(found, 'грант должен быть в списке');
    assert.ok((resList.body.periods || []).some(p => p.id === archivedId), 'архивный период должен быть в списке периодов');

    // Попытка выдать грант на ТЕКУЩИЙ период — отклоняется.
    const latest = await queryOne('SELECT id FROM periods ORDER BY id DESC LIMIT 1');
    const resGrantCurrent = fakeRes();
    await adminController.grantPeriodEdit(
      { body: { userLogin: TEST_LOGIN, periodId: latest.id }, user: adminUser },
      resGrantCurrent
    );
    assert.equal(resGrantCurrent.statusCode, 400);

    // Отзыв.
    const resRevoke = fakeRes();
    await adminController.revokePeriodEdit(
      { body: { userLogin: TEST_LOGIN, periodId: archivedId }, user: adminUser },
      resRevoke
    );
    assert.equal(resRevoke.statusCode, 200);
    const row2 = await queryOne('SELECT 1 FROM period_edit_grants WHERE user_login = ? AND period_id = ?', [TEST_LOGIN, archivedId]);
    assert.equal(row2, null, 'после отзыва грант не должен существовать');

    console.log('OK: выдача/продление/список/защита текущего периода/отзыв — всё корректно');
  } finally {
    await run('DELETE FROM period_edit_grants WHERE user_login = ?', [TEST_LOGIN]);
    await run('DELETE FROM periods WHERE id = ?', [archivedId]);
  }
  process.exit(0);
})().catch(err => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 4: Запустить проверку**

```bash
cd "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis" && node scratch/verify_task5_admin_grants.js
```

Ожидается: `OK: выдача/продление/список/защита текущего периода/отзыв — всё корректно`.

- [ ] **Step 5: Прибрать и закоммитить**

```bash
rm scratch/verify_task5_admin_grants.js
git add src/controllers/adminController.js src/routes/api.js
git commit -m "feat(админка): выдача/отзыв/список доступов к архивному году

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `getUserPayload` возвращает мои активные гранты

**Files:**
- Modify: `src/controllers/authController.js`
- Create: `scratch/verify_task6_my_grants.js`

**Interfaces:**
- Produces: ответ `getUserPayload` содержит `myPeriodGrants: [{periodId, periodName, expiresAt}]` — только активные гранты текущего пользователя.

- [ ] **Step 1: Добавить запрос грантов**

В `src/controllers/authController.js`, найти место, где резолвится `period` перед общим `Promise.all` (добавлено прошлой задачей, начало функции `getUserPayload`, строка ~156: `const period = await cached('period', () => getPeriodInfo(), 30 * 1000);`). Сразу после этой строки добавить:

```javascript
  const myPeriodGrantsRaw = await queryAll(
    `SELECT g.period_id AS "periodId", p.name AS "periodName", g.expires_at AS "expiresAt"
     FROM period_edit_grants g JOIN periods p ON p.id = g.period_id
     WHERE g.user_login = ? AND g.expires_at > CURRENT_TIMESTAMP`,
    [user.login]
  );
```

(Не кэшируется через `cached()` — это данные конкретного пользователя, которые могут появиться/исчезнуть в любой момент по действию админа, как и остальные пользовательские данные в этой функции, см. существующий комментарий про `compRows`/`survRows` в начале файла.)

- [ ] **Step 2: Добавить в возвращаемый объект**

Найти в конце функции `period,` (строка ~372, внутри финального `res.json`-объекта, рядом с `mustChangePassword`). Заменить:

```javascript
    period,
    mustChangePassword: !!user.must_change_password,
```

на:

```javascript
    period,
    myPeriodGrants: myPeriodGrantsRaw,
    mustChangePassword: !!user.must_change_password,
```

- [ ] **Step 3: Скрипт проверки**

Создать `scratch/verify_task6_my_grants.js` — поскольку `getUserPayload` не экспортируется напрямую (внутренняя функция контроллера `login`/`resume`), проверяем тот же SQL-паттерн, который использует Step 1:

```javascript
'use strict';
// Разовая проверка Задачи 6. Запуск: node scratch/verify_task6_my_grants.js

const assert = require('node:assert/strict');
const { queryAll, run } = require('../src/db/database');

const TEST_LOGIN = 'ЭЭЭ_ТЕСТ_mygrants_qa';

(async () => {
  const archived = await run(
    "INSERT INTO periods (name, state, updated_by) VALUES ('ЭЭЭ_ТЕСТ_period_mygrants', 'закрыт', 'qa')"
  );
  const archivedId = Number(archived.lastInsertRowid);

  try {
    await run(
      "INSERT INTO period_edit_grants (user_login, period_id, granted_by, expires_at) VALUES (?, ?, 'qa', datetime('now', '+1 day'))",
      [TEST_LOGIN, archivedId]
    );
    // Второй, уже истёкший грант — не должен попасть в выборку.
    const expiredPeriod = await run(
      "INSERT INTO periods (name, state, updated_by) VALUES ('ЭЭЭ_ТЕСТ_period_mygrants_expired', 'закрыт', 'qa')"
    );
    const expiredId = Number(expiredPeriod.lastInsertRowid);
    await run(
      "INSERT INTO period_edit_grants (user_login, period_id, granted_by, expires_at) VALUES (?, ?, 'qa', datetime('now', '-1 hour'))",
      [TEST_LOGIN, expiredId]
    );

    const rows = await queryAll(
      `SELECT g.period_id AS "periodId", p.name AS "periodName", g.expires_at AS "expiresAt"
       FROM period_edit_grants g JOIN periods p ON p.id = g.period_id
       WHERE g.user_login = ? AND g.expires_at > CURRENT_TIMESTAMP`,
      [TEST_LOGIN]
    );

    assert.equal(rows.length, 1, 'должен вернуться только активный грант');
    assert.equal(rows[0].periodId, archivedId);

    console.log('OK: выборка активных грантов пользователя исключает истёкшие');

    await run('DELETE FROM periods WHERE id = ?', [expiredId]);
  } finally {
    await run('DELETE FROM period_edit_grants WHERE user_login = ?', [TEST_LOGIN]);
    await run('DELETE FROM periods WHERE id = ?', [archivedId]);
  }
  process.exit(0);
})().catch(err => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 4: Запустить проверку**

```bash
cd "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis" && node scratch/verify_task6_my_grants.js
```

Ожидается: `OK: выборка активных грантов пользователя исключает истёкшие`.

- [ ] **Step 5: Прибрать и закоммитить**

```bash
rm scratch/verify_task6_my_grants.js
git add src/controllers/authController.js
git commit -m "feat(сессия): getUserPayload возвращает мои активные гранты на архив

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Фронтенд — новые вызовы API (`app-core.js`)

**Files:**
- Modify: `public/app-core.js`

**Interfaces:**
- Produces: `apiSurveysForPeriod`, `apiPeriodGrantsPanel`, `apiPeriodGrantCreate`, `apiPeriodGrantRevoke`, `apiPeriodGrantUsers` — вызываемые как `call('apiXxx', S.token, ...)`.

- [ ] **Step 1: Добавить обёртки**

В `public/app-core.js`, сразу после существующей строки `apiSaveSurvey: function(args){ return fetchJson('/api/survey/save-details', { method:'POST', token:args[0], body:args[1] }); },` (строка 675), добавить:

```javascript
  apiSurveysForPeriod: function(args){ return fetchJson('/api/survey/for-period', { method:'POST', token:args[0], body:{ unit:args[1], periodId:args[2] } }); },
  apiPeriodGrantsPanel: function(args){ return fetchJson('/api/admin/period-grants', { method:'GET', token:args[0] }); },
  apiPeriodGrantUsers: function(args){ return fetchJson('/api/admin/period-grants/users', { method:'GET', token:args[0] }); },
  apiPeriodGrantCreate: function(args){ return fetchJson('/api/admin/period-grants', { method:'POST', token:args[0], body:{ userLogin:args[1], periodId:args[2] } }); },
  apiPeriodGrantRevoke: function(args){ return fetchJson('/api/admin/period-grants/revoke', { method:'POST', token:args[0], body:{ userLogin:args[1], periodId:args[2] } }); },
```

(Сигнатура та же, что у соседних обёрток в этом файле — `args[0]` всегда токен, дальше позиционные параметры конкретного вызова.)

- [ ] **Step 2: Синтаксическая проверка**

```bash
cd "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis" && node --check public/app-core.js
```

Ожидается: без ошибок (exit 0, без вывода).

- [ ] **Step 3: Закоммитить**

```bash
git add public/app-core.js
git commit -m "feat(фронт): API-обёртки для точечного доступа к архиву

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Админский экран — выдача и отзыв доступа

**Files:**
- Modify: `public/app.js` (`renderAdminPeriod`)

**Interfaces:**
- Consumes: `apiPeriodGrantsPanel`, `apiPeriodGrantUsers`, `apiPeriodGrantCreate`, `apiPeriodGrantRevoke` (Task 7).

- [ ] **Step 1: Расширить `renderAdminPeriod`**

Найти текущую функцию `renderAdminPeriod` в `public/app.js` (ищется по `function renderAdminPeriod(){` — точный номер строки мог сместиться из-за более ранних задач, ориентироваться на текст, не на номер строки):

```javascript
// ─── Вкладка: Период сбора ───
function renderAdminPeriod(){
  var p = S.data.period || {};
  var closed = p.state === 'закрыт';
  var canEdit = hasCap('period:edit');

  var h = '<div class="card period-card">'+
    '<div class="period-card-kicker">Текущий период сбора</div>'+
    '<div class="period-card-name">'+esc(p.name || 'Обзор рынка')+'</div>'+
    '<div class="period-card-meta">'+
      'Статус: <b class="'+(closed?'is-no':'is-ok')+'">'+esc(p.state || 'открыт')+'</b>'+
      (p.from ? ' · с '+esc(p.from) : '') + (p.to ? ' · по '+esc(p.to) : '') +
      (p.by ? '<br>Изменил: <b>'+esc(p.by)+'</b>'+(p.at?' ('+esc(fmtDateTime(p.at))+')':'') : '') +
    '</div>'+
    (canEdit
      ? (closed
          ? '<button id="btnAdminPeriodOpen" class="btn-line period-card-act is-open">Открыть новый период</button>'
          : '<button id="btnAdminPeriodClose" class="btn-line btn-danger period-card-act">Закрыть период сбора</button>')
      : '')+
  '</div>';

  $('adminContent').innerHTML = h;
```

заменить на:

```javascript
// ─── Вкладка: Период сбора ───
function renderAdminPeriod(){
  var p = S.data.period || {};
  var closed = p.state === 'закрыт';
  var canEdit = hasCap('period:edit');

  var h = '<div class="card period-card">'+
    '<div class="period-card-kicker">Текущий период сбора</div>'+
    '<div class="period-card-name">'+esc(p.name || 'Обзор рынка')+'</div>'+
    '<div class="period-card-meta">'+
      'Статус: <b class="'+(closed?'is-no':'is-ok')+'">'+esc(p.state || 'открыт')+'</b>'+
      (p.from ? ' · с '+esc(p.from) : '') + (p.to ? ' · по '+esc(p.to) : '') +
      (p.by ? '<br>Изменил: <b>'+esc(p.by)+'</b>'+(p.at?' ('+esc(fmtDateTime(p.at))+')':'') : '') +
    '</div>'+
    (canEdit
      ? (closed
          ? '<button id="btnAdminPeriodOpen" class="btn-line period-card-act is-open">Открыть новый период</button>'
          : '<button id="btnAdminPeriodClose" class="btn-line btn-danger period-card-act">Закрыть период сбора</button>')
      : '')+
  '</div>'+
  (canEdit ? '<div class="card period-grants-card" style="margin-top:14px">'+
    '<div class="period-card-kicker">Доступ к редактированию архива</div>'+
    '<div id="periodGrantsForm" style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0"></div>'+
    '<div id="periodGrantsList">Загрузка…</div>'+
  '</div>' : '');

  $('adminContent').innerHTML = h;

  if(canEdit) loadPeriodGrantsPanel();
```

(Оставшаяся часть функции — обработчики `$('btnAdminPeriodOpen')`/`$('btnAdminPeriodClose')` — не меняется, следует сразу за этим блоком как и раньше.)

- [ ] **Step 2: Добавить `loadPeriodGrantsPanel` и вспомогательные функции**

Сразу после конца функции `renderAdminPeriod` (после её закрывающей `}`), добавить:

```javascript
function periodGrantTimeLeft(expiresAt){
  var ms = new Date(expiresAt).getTime() - Date.now();
  if(ms <= 0) return 'истёк';
  var h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return (h>0 ? h+'ч ' : '') + m+'м';
}

function loadPeriodGrantsPanel(){
  Promise.all([
    call('apiPeriodGrantsPanel', S.token),
    call('apiPeriodGrantUsers', S.token)
  ]).then(function(res){
    var panel = res[0], usersRes = res[1];
    if(!panel || !panel.ok){
      $('periodGrantsList').innerHTML = '<div class="err">'+esc((panel&&panel.error)||'Ошибка загрузки')+'</div>';
      return;
    }
    var periods = panel.periods || [];
    var users = (usersRes && usersRes.ok ? usersRes.users : []).filter(function(u){ return u.active; });

    if(!periods.length){
      $('periodGrantsForm').innerHTML = '<div class="note">Архивных годов пока нет — доступ не на что выдавать.</div>';
    } else {
      $('periodGrantsForm').innerHTML =
        niceSelect({ id:'grantUserSel', width:220, items: users.map(function(u){ return { v:u.login, label:u.fio+' ('+u.login+')' }; }) })+
        niceSelect({ id:'grantPeriodSel', width:200, items: periods.map(function(p){ return { v:String(p.id), label:p.name }; }) })+
        '<button id="btnGrantPeriod" class="btn-line">Выдать на 24 часа</button>';
      wireNiceSelect('grantUserSel', function(){});
      wireNiceSelect('grantPeriodSel', function(){});
      $('btnGrantPeriod').onclick = function(){
        var userLogin = $('grantUserSel').dataset.value;
        var periodId = $('grantPeriodSel').dataset.value;
        if(!userLogin || !periodId){ toast('Выберите сотрудника и год', 'no'); return; }
        call('apiPeriodGrantCreate', S.token, userLogin, Number(periodId)).then(function(r){
          if(r && r.ok){ toast('Доступ выдан на 24 часа'); loadPeriodGrantsPanel(); }
          else toast((r&&r.error)||'Ошибка', 'no');
        });
      };
    }

    renderPeriodGrantsList(panel.grants || []);
  });
}

function renderPeriodGrantsList(grants){
  if(!grants.length){
    $('periodGrantsList').innerHTML = '<div class="note">Сейчас нет активных выданных доступов.</div>';
    return;
  }
  $('periodGrantsList').innerHTML = '<table class="co-tbl"><thead><tr>'+
    '<th>Сотрудник</th><th>Год</th><th>Истекает</th><th></th>'+
    '</tr></thead><tbody>'+
    grants.map(function(g){
      return '<tr>'+
        '<td>'+esc(g.userFio)+'</td>'+
        '<td>'+esc(g.periodName)+'</td>'+
        '<td>'+periodGrantTimeLeft(g.expiresAt)+'</td>'+
        '<td><button class="btn-ghost btn-danger" data-revoke-user="'+esc(g.userLogin)+'" data-revoke-period="'+g.periodId+'">Отозвать</button></td>'+
      '</tr>';
    }).join('')+
    '</tbody></table>';

  $('periodGrantsList').querySelectorAll('button[data-revoke-user]').forEach(function(btn){
    btn.onclick = function(){
      call('apiPeriodGrantRevoke', S.token, btn.dataset.revokeUser, Number(btn.dataset.revokePeriod)).then(function(r){
        if(r && r.ok){ toast('Доступ отозван'); loadPeriodGrantsPanel(); }
        else toast((r&&r.error)||'Ошибка', 'no');
      });
    };
  });
}
```

- [ ] **Step 3: Синтаксическая проверка**

```bash
cd "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis" && node --check public/app.js
```

- [ ] **Step 4: Проверка в браузере**

Запустить dev-сервер (`.env` скопирован, см. Environment Setup Note): `npm run dev`. Зайти под учёткой с `period:edit` (admin/hrbp) → Админка → «Период сбора». Ожидается: под существующей карточкой периода — новый блок «Доступ к редактированию архива». Если в базе всего один период — форма покажет «Архивных годов пока нет», без ошибок в консоли. Если проверка в браузере в этом окружении невозможна (нет учётных данных) — прямо сказать об этом в отчёте, не выдумывать результат.

- [ ] **Step 5: Закоммитить**

```bash
git add public/app.js
git commit -m "feat(админка): экран выдачи и отзыва доступа к архивному году

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Форма подразделения — переключатель года и ограниченное сохранение

**Files:**
- Modify: `public/app.js` (`renderUnit`, `markDirty`, новые функции)

**Interfaces:**
- Consumes: `S.data.myPeriodGrants` (Task 6), `apiSurveysForPeriod` (Task 7).

- [ ] **Step 1: Добавить слот баннера в `renderUnit`**

Найти в `renderUnit()` (искать по тексту, номер строки мог сместиться):

```javascript
  var h = '<div class="unit-content-wrap">'+
    '<div class="unit-sticky-bar">'+
      '<div class="sub-tabs unit-step-tabs">'+
        '<button data-tab="comp" class="sub-tab '+(S.tab==='comp'?'on':'')+'">'+
          'Шаг 1. Участники рынка'+
          ' <span class="badge '+(step1done?'b-active':'b-dim')+'" style="margin-left:4px">'+c.done+'/'+c.all+'</span>'+
          (c.ask ? ' <span class="badge b-blocked" style="margin-left:4px;color:var(--warn);background:var(--warn-soft)">?'+c.ask+' на уточнении</span>' : '')+
        '</button>'+
        '<button data-tab="survey" class="sub-tab '+(S.tab==='survey'?'on':'')+'">'+
          'Шаг 2. Данные по рынку'+
          ' <span class="badge '+(S.surveys.length>0?'b-active':'b-dim')+'" style="margin-left:4px">'+svLabel()+'</span>'+
        '</button>'+
      '</div>'+
      '<div id="unitHeadToolbar" class="unit-head-toolbar"></div>'+
    '</div>'+
    '<div id="tabBody"></div>'+
  '</div>';
  $('body').innerHTML = h;

  $('body').querySelector('.unit-step-tabs').onclick = function(e){
    var b = e.target.closest('button[data-tab]');
    if(!b || b.dataset.tab === S.tab) return;
    S.tab = b.dataset.tab;
    renderUnit();
  };

  if(S.tab === 'comp') renderTabComp();
  else renderTabSurvey();
```

заменить на:

```javascript
  var inArchiveMode = !!S.editingPeriodId;
  var h = '<div class="unit-content-wrap">'+
    '<div id="unitPeriodBanner"></div>'+
    '<div class="unit-sticky-bar">'+
      '<div class="sub-tabs unit-step-tabs">'+
        (inArchiveMode ? '' :
        '<button data-tab="comp" class="sub-tab '+(S.tab==='comp'?'on':'')+'">'+
          'Шаг 1. Участники рынка'+
          ' <span class="badge '+(step1done?'b-active':'b-dim')+'" style="margin-left:4px">'+c.done+'/'+c.all+'</span>'+
          (c.ask ? ' <span class="badge b-blocked" style="margin-left:4px;color:var(--warn);background:var(--warn-soft)">?'+c.ask+' на уточнении</span>' : '')+
        '</button>')+
        '<button data-tab="survey" class="sub-tab '+(S.tab==='survey'?'on':'')+'">'+
          (inArchiveMode ? 'Данные по рынку (архив)' : 'Шаг 2. Данные по рынку')+
          ' <span class="badge '+(S.surveys.length>0?'b-active':'b-dim')+'" style="margin-left:4px">'+svLabel()+'</span>'+
        '</button>'+
      '</div>'+
      '<div id="unitHeadToolbar" class="unit-head-toolbar"></div>'+
    '</div>'+
    '<div id="tabBody"></div>'+
  '</div>';
  $('body').innerHTML = h;
  renderUnitPeriodBanner();

  if(inArchiveMode) S.tab = 'survey';

  $('body').querySelector('.unit-step-tabs').onclick = function(e){
    var b = e.target.closest('button[data-tab]');
    if(!b || b.dataset.tab === S.tab) return;
    S.tab = b.dataset.tab;
    renderUnit();
  };

  if(S.tab === 'comp' && !inArchiveMode) renderTabComp();
  else renderTabSurvey();
```

(В архивном режиме Шаг 1 недоступен вообще — компании-конкуренты не привязаны к году, редактировать их «за прошлый год» не имеет смысла, см. Global Constraints этого плана.)

- [ ] **Step 2: Добавить рендер баннера и переключение периода**

В конец `public/app.js` (или сразу после `renderUnit`), добавить:

```javascript
function renderUnitPeriodBanner(){
  var el = $('unitPeriodBanner');
  if(!el) return;
  var grants = (S.data.myPeriodGrants || []);
  if(!grants.length){ el.innerHTML = ''; return; }

  var curName = (S.data.period && S.data.period.name) || 'текущий';
  var options = [{ id:null, label: curName + ' (текущий)' }].concat(grants.map(function(g){
    return { id: g.periodId, label: g.periodName + ' (архив, ' + periodGrantTimeLeft(g.expiresAt) + ')' };
  }));

  el.innerHTML = '<div class="unit-period-banner" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">'+
    options.map(function(o){
      var on = (S.editingPeriodId || null) === o.id;
      return '<button type="button" class="sub-tab'+(on?' on':'')+'" data-pid="'+esc(o.id==null?'':String(o.id))+'">'+esc(o.label)+'</button>';
    }).join('')+
  '</div>';

  el.querySelectorAll('button[data-pid]').forEach(function(btn){
    btn.onclick = function(){
      var pid = btn.dataset.pid ? Number(btn.dataset.pid) : null;
      switchUnitEditingPeriod(pid);
    };
  });
}

function switchUnitEditingPeriod(periodId){
  if(periodId === (S.editingPeriodId || null)) return;

  if(periodId == null){
    S.editingPeriodId = null;
    S.surveys = S.data.surveys.filter(function(r){ return r.unit === S.unit; })
                              .map(function(r){ return JSON.parse(JSON.stringify(r)); });
    S.removed = [];
    $('btnSave').onclick = function(){ save(false); };
    renderUnit();
    return;
  }

  call('apiSurveysForPeriod', S.token, S.unit, periodId).then(function(res){
    if(!res || !res.ok){ toast((res&&res.error)||'Ошибка загрузки архивных данных', 'no'); return; }
    S.editingPeriodId = periodId;
    S.surveys = res.surveys || [];
    S.removed = [];
    $('btnSave').onclick = function(){ doSaveArchive(); };
    renderUnit();
  });
}

function doSaveArchive(){
  if(S.saving) return;
  S.saving = true;
  $('btnSave').disabled = true;
  $('btnSave').textContent = 'Сохраняем…';

  call('apiSaveSurvey', S.token, { unit: S.unit, upsert: S.surveys, remove: S.removed, periodId: S.editingPeriodId }).then(function(res){
    S.saving = false;
    $('btnSave').disabled = false;
    $('btnSave').textContent = 'Сохранить';

    if(!res || !res.ok){
      toast((res && res.error) || 'Не удалось сохранить', 'no');
      return;
    }

    S.surveys.forEach(function(x, k){
      if(!x.id) x.id = (res.newIds && res.newIds[k]) || x.id;
    });
    S.removed = [];
    S.dirty = false;
    toast('Архивные данные сохранены', 'ok');
    renderTabSurvey();
  });
}
```

- [ ] **Step 3: Не писать локальный черновик в архивном режиме**

Найти `markDirty()`:

```javascript
function markDirty(){
  if(S.ro) return;
  var was = S.dirty;
  S.dirty = true;
  store.set(LS_DRAFT+S.unit, JSON.stringify({
    rows: S.rows,
    added: S.added,
    surveys: S.surveys,
    removed: S.removed,
    note: S.note,
    tab: S.tab || 'comp',
    savedAt: new Date().toISOString()
  }));
  if(!was){
    var b = $('btnSave');
    if(b) b.classList.toggle('hidden', S.ro);
  }
}
```

заменить на:

```javascript
function markDirty(){
  if(S.ro) return;
  var was = S.dirty;
  S.dirty = true;
  // Локальный черновик привязан только к unit, без учёта года — в архивном
  // режиме НЕ сохраняем его, иначе он может подмешать архивные правки в
  // черновик текущего года при следующем обычном открытии этого же
  // подразделения (ключ LS_DRAFT+unit один и тот же для обоих режимов).
  if(!S.editingPeriodId){
    store.set(LS_DRAFT+S.unit, JSON.stringify({
      rows: S.rows,
      added: S.added,
      surveys: S.surveys,
      removed: S.removed,
      note: S.note,
      tab: S.tab || 'comp',
      savedAt: new Date().toISOString()
    }));
  }
  if(!was){
    var b = $('btnSave');
    if(b) b.classList.toggle('hidden', S.ro);
  }
}
```

- [ ] **Step 4: Сбрасывать `S.editingPeriodId` при выходе из подразделения**

Найти `openUnit(unit, backTo)` (начало функции):

```javascript
function openUnit(unit, backTo){
  S.backTo = backTo || renderUnits;
  S.appView = 'unit';
  S.unit = unit;
  S.tab = 'comp';
  saveNavState();
```

заменить на:

```javascript
function openUnit(unit, backTo){
  S.backTo = backTo || renderUnits;
  S.appView = 'unit';
  S.unit = unit;
  S.tab = 'comp';
  S.editingPeriodId = null;
  saveNavState();
```

(Каждое открытие подразделения заново начинается с текущего года — переключение на архив происходит заново через баннер, если грант ещё активен.)

- [ ] **Step 5: Синтаксическая проверка**

```bash
cd "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis" && node --check public/app.js
```

- [ ] **Step 6: Проверка в браузере**

Запустить dev-сервер. Без активных грантов у тестового пользователя — открыть любое подразделение, форма выглядит как раньше, баннера нет (`S.data.myPeriodGrants` пуст). Если возможно завести тестовый грант через админский экран (Task 8) на тестовый архивный период и залогиниться под тем же пользователем — проверить, что баннер появляется, переключение на архив скрывает Шаг 1, подгружает архивные данные, сохранение уходит через `doSaveArchive`. Если проверка в браузере невозможна в этом окружении — сказать об этом прямо, не выдумывать результат; ручной сценарий полностью повторяется в Задаче 10.

- [ ] **Step 7: Закоммитить**

```bash
git add public/app.js
git commit -m "feat(форма): переключатель года для точечного редактирования архива

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Сквозная проверка на реальных данных

Эта задача менее рискованна, чем аналогичная в предыдущей задаче (годовой архив) — она не закрывает/открывает реальный период и не трогает данные других людей, только создаёт и отзывает один тестовый грант и правит анкеты одного тестового (или заведомо согласованного) подразделения. Тем не менее — реальные данные на общей базе, поэтому действовать аккуратно и с тестовыми/явно согласованными записями.

**Files:** нет изменений кода — только ручная проверка через браузер.

- [ ] **Step 1: Выдать себе (или тестовому пользователю) доступ**

Через Админку → «Период сбора» → «Доступ к редактированию архива» — выбрать сотрудника (можно себя, если роль позволяет) и архивный год (если в реальной базе всего один период — сначала нужно открыть новый период через существующую кнопку «Открыть новый период», чтобы появился хотя бы один архивный год для теста; согласовать этот шаг с пользователем отдельно, так как он реально меняет текущий период сбора на общей базе).

- [ ] **Step 2: Зайти под этим пользователем, проверить баннер**

Открыть любое подразделение, доступное этому пользователю → сверху должен появиться переключатель года.

- [ ] **Step 3: Отредактировать архивный год**

Переключиться на архивный вариант → убедиться, что Шаг 1 исчез, Шаг 2 показывает данные именно архивного года → изменить одно значение → сохранить → убедиться в сообщении «Архивные данные сохранены».

- [ ] **Step 4: Убедиться, что текущий год не тронут**

Переключиться обратно на текущий год в этом же баннере (или выйти и зайти заново) → убедиться, что данные текущего года остались прежними.

- [ ] **Step 5: Отозвать доступ**

Админка → «Доступ к редактированию архива» → «Отозвать» у этой строки → зайти заново под тестовым пользователем → баннер должен исчезнуть, попытка сохранить с этим `periodId` напрямую (если пробовать) должна вернуть ошибку доступа.

- [ ] **Step 6: Итоговый отчёт пользователю**

Сообщить пользователю прямо и простыми словами, что именно проверено и сработало ли всё как задумано.
