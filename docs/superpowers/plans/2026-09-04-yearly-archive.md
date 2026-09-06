# Годовой архив обзора рынка — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разделить анкеты обзора рынка по годам сбора (жёсткая привязка `surveys.period_id` вместо неиспользуемой текстовой метки), сделать так, чтобы открытие нового периода давало пустую форму заполнения для каждого подразделения, и дать дашборду переключатель года для раздельного просмотра/сравнения.

**Architecture:** Все анкеты (`surveys`) получают колонку `period_id`, ссылающуюся на `periods.id`. Поиск «уже есть запись» при сохранении анкеты и подгрузка анкет в форму учитывают текущий открытый период — значит новый период автоматически даёт чистую форму, без переноса/удаления старых данных. Дашборд (`analyticsService`) принимает необязательный `periodId` в фильтрах, по умолчанию — последний период; фронт добавляет выпадающий список годов рядом с существующими фильтрами дашборда. Ничего не удаляется физически — откат равносилен простому возврату к старому периоду.

**Tech Stack:** Node.js + Express, `@libsql/client` (Turso, без ORM — сырой SQL через `src/db/database.js`), ванильный JS на фронте (`public/app.js`, без сборки), `node --test` для юнит-тестов чистых функций.

**Spec:** [docs/superpowers/specs/2026-09-04-yearly-archive-design.md](../specs/2026-09-04-yearly-archive-design.md)

## Global Constraints

- Ничего не удаляется и не переносится физически — только добавляется колонка и фильтры. Откат = вручную выбрать старый период в админке, данные все на месте.
- `divisions` (оргструктура самого Фаровон) эта задача не трогает. Список компаний-конкурентов и их статус актуальности — таблица `competitors` (не путать с `divisions`).
- Открывать/архивировать период может только роль с правом `period:edit` (сейчас: `admin`, `hrbp`) — не меняем модель прав, только чиним фронт, чтобы кнопка не показывалась без права.
- Дашборд уже полностью read-only (нет кнопок редактирования ни на одной вкладке) — «архивный год только на просмотр» ничего не требует чинить отдельно, это уже так по устройству экрана.
- **В проекте нет тестовой базы данных** — `src/db/database.js` всегда подключается к живой Turso (см. `.env` → `TURSO_DATABASE_URL`). Юнит-тесты (`test/*.test.js`, `node --test`) покрывают только чистые функции без обращения к БД — этому же следуем здесь. Проверка кода, трогающего БД, идёт через одноразовые скрипты в `scratch/` (см. `.gitignore` — папка уже заведена именно для этого и не коммитится), которые создают СВОИ тестовые строки с явным тегом в имени (например `unit = 'ЭЭЭ_ТЕСТ_period_qa'`) и удаляют их в `finally`, не трогая реальные данные.
- ⚠️ **Задача 8 требует реального открытия нового периода на живой базе** (общей для обоих ноутбуков пользователя) — это ощутимое действие с реальными последствиями (сброс `actual` у всех конкурентов, закрытие текущего цикла сбора для всех). НЕ выполнять автоматически без явного подтверждения пользователя в чате прямо перед этим шагом — см. предупреждение в самой задаче 8.

## Environment Setup Note

Эта сессия работает в git worktree (`.claude/worktrees/sync-data-laptops-9a0bb7`) — там нет файла `.env` (он не копируется в worktree, это нормально, `.env` в `.gitignore`). Реальные `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` есть только в основной папке проекта:
`C:\Users\Acer\projects\Farovon Market Analysis\Farovon Market Analysis\.env`

Поэтому для любого шага, где нужно реально подключиться к базе (`npm run dev`, `node scratch/...`), запускать команду нужно из основной папки, а не из worktree — например:

```bash
cd "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis" && npm run dev
```

Файлы кода при этом редактируются в worktree как обычно (обе копии на диске — это два отдельных чекаута одного и того же git-репозитория; после того как ветка worktree будет слита/запушена, изменения появятся и в основной папке через `git pull`). Простой способ проверить руками без слияния веток — временно скопировать `.env` в worktree на время локальной проверки (файл в `.gitignore`, в коммит не попадёт).

---

### Task 1: Схема — `surveys.period_id`

**Files:**
- Modify: `src/db/schema.sql:60-87` (документация схемы — добавить колонку в `CREATE TABLE surveys`)
- Modify: `src/db/migrate.js` (добавить миграцию в конец функции `migrate()`, перед `console.log('🔧 Миграция: таблицы бенчмаркинга...')` в самом начале функции — порядок миграций в файле не важен, идёт последовательно)
- Create: `scratch/verify_task1_period_id.js` (одноразовая проверка, не коммитится)

**Interfaces:**
- Produces: колонка `surveys.period_id INTEGER` (нулевая для строк, у которых не было ни одного периода на момент миграции — в проде такого не будет, там уже есть периоды), индекс `idx_surveys_period`. Все существующие строки получают `period_id` самой первой (по `id`) строки `periods`.

- [ ] **Step 1: Добавить колонку в `schema.sql` (документация)**

В `src/db/schema.sql` найти блок `CREATE TABLE IF NOT EXISTS surveys (` (строка 60) и добавить колонку `period_id` перед закрывающей скобкой (строка 87, `state TEXT DEFAULT 'активна', period TEXT`):

```sql
  state TEXT DEFAULT 'активна',
  period TEXT,
  period_id INTEGER REFERENCES periods(id) -- жёсткая привязка к году сбора; period (текст) остаётся для истории/обратной совместимости
);
```

- [ ] **Step 2: Добавить идемпотентную миграцию в `migrate.js`**

В `src/db/migrate.js`, в конец функции `migrate()` (перед закрывающей `}` и `console.log('🔧 Миграция: таблицы бенчмаркинга...')`, то есть можно сразу после блока индексов бенчмаркинга, перед сидом `defaultSources`), добавить:

```javascript
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
```

`queryOne` уже импортирован в файле (`const { queryAll, run } = require('./database');` — нужно добавить `queryOne` в этот импорт на строке 1):

```javascript
const { queryAll, queryOne, run } = require('./database');
```

- [ ] **Step 3: Написать одноразовый скрипт проверки**

Создать `scratch/verify_task1_period_id.js`:

```javascript
'use strict';
// Разовая проверка Задачи 1. Запуск: node scratch/verify_task1_period_id.js
// (из основной папки проекта, где есть .env с реальными TURSO_* — см.
// docs/superpowers/plans/2026-09-04-yearly-archive.md → Environment Setup Note)

const { queryAll, queryOne } = require('../src/db/database');
const { migrate } = require('../src/db/migrate');

(async () => {
  await migrate(); // идемпотентно — безопасно гонять повторно на реальной базе

  const cols = await queryAll('PRAGMA table_info(surveys)');
  const hasCol = cols.some(c => c.name === 'period_id');
  if (!hasCol) throw new Error('FAIL: surveys.period_id не создана');

  const nullCount = await queryOne("SELECT COUNT(*) AS n FROM surveys WHERE period_id IS NULL");
  if (Number(nullCount.n) > 0) {
    throw new Error(`FAIL: ${nullCount.n} анкет(ы) без period_id после бэкафилла`);
  }

  const idx = await queryAll("PRAGMA index_list(surveys)");
  if (!idx.some(i => i.name === 'idx_surveys_period')) {
    throw new Error('FAIL: индекс idx_surveys_period не создан');
  }

  console.log('OK: surveys.period_id есть, бэкафилл полный, индекс на месте');
  process.exit(0);
})().catch(err => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 4: Запустить проверку**

```bash
cd "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis" && node scratch/verify_task1_period_id.js
```

Ожидается: `OK: surveys.period_id есть, бэкафилл полный, индекс на месте`. Это реальная (не тестовая) база — миграция аддитивная (только добавляет колонку/индекс и проставляет `period_id` там, где он был `NULL`), безопасна для прод-данных, ничего не удаляет и не меняет существующие значения.

- [ ] **Step 5: Удалить одноразовый скрипт и закоммитить схему/миграцию**

`scratch/` в `.gitignore` — скрипт и так не попадёт в коммит, удалять физически не обязательно, но лучше прибрать за собой:

```bash
rm scratch/verify_task1_period_id.js
git add src/db/schema.sql src/db/migrate.js
git commit -m "feat(бд): surveys.period_id — жёсткая привязка анкеты к году сбора

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Сохранение анкеты помечает период, поиск существующей строки учитывает год

**Files:**
- Modify: `src/controllers/surveyController.js` (`saveSurveyDetails`, строки 249-552)
- Create: `scratch/verify_task2_survey_period.js`

**Interfaces:**
- Consumes: `surveys.period_id` (Task 1).
- Produces: любой `INSERT INTO surveys` из этой функции теперь пишет `period_id`; любой `UPDATE`/`SELECT`, адресующий существующую строку по `sid`, дополнительно проверяет `period_id = ?` — строка из чужого (не текущего) периода не находится и не перезаписывается.

- [ ] **Step 1: Получать `id` текущего периода**

В `saveSurveyDetails` (строка 331) заменить:

```javascript
    const period = (await queryOne('SELECT state, name FROM periods ORDER BY id DESC LIMIT 1')) || { state: 'открыт', name: 'Обзор рынка' };
```

на:

```javascript
    const period = (await queryOne('SELECT id, state, name FROM periods ORDER BY id DESC LIMIT 1')) || { id: null, state: 'открыт', name: 'Обзор рынка' };
```

- [ ] **Step 2: Смежная группа — искать существующие строки только в текущем периоде**

Строки 365-368, заменить:

```javascript
        const existingRows = await queryAll(
          `SELECT sid, unit, pos_our, company FROM surveys WHERE unit IN (${ph}) AND state = 'активна'`,
          groupUnits
        );
```

на:

```javascript
        const existingRows = await queryAll(
          `SELECT sid, unit, pos_our, company FROM surveys WHERE unit IN (${ph}) AND state = 'активна' AND period_id = ?`,
          [...groupUnits, period.id]
        );
```

- [ ] **Step 3: Смежная группа — UPDATE/INSERT проставляют/проверяют период**

Строки 385-406, заменить блок:

```javascript
            if (sid) {
              gStmts.push({
                sql: `UPDATE surveys
                      SET company = ?, pos_our = ?, pos_their = ?, grade = ?, pay_from = ?, pay_to = ?, cur = ?, pay_per = ?,
                          bon_has = ?, bon_size = ?, bon_type = ?, bon_per = ?, bonuses = ?, benefits = ?, schedule = ?, extra = ?, source = ?, trust = ?, note = ?
                      WHERE sid = ? AND unit = ?`,
                args: [
                  s.company, s.posOur, s.posTheir, s.grade, s.pFrom, s.pTo, s.cur, s.payPer,
                  s.bonHas, s.bonSize, s.bonType, s.bonPer, s.bonuses, s.benefits, s.schedule, s.extra, s.source, s.trust, s.note,
                  sid, gu
                ]
              });
            } else {
              const newSid = newRowId('s');
              gStmts.push({
                sql: `INSERT INTO surveys (sid, unit, company, pos_our, pos_their, grade, pay_from, pay_to, cur, pay_per, bon_has, bon_size, bon_type, bon_per, bonuses, benefits, schedule, extra, source, trust, note, created_by, created_at, state, period)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'активна', ?)`,
                args: [
                  newSid, gu, s.company, s.posOur, s.posTheir, s.grade, s.pFrom, s.pTo, s.cur, s.payPer,
                  s.bonHas, s.bonSize, s.bonType, s.bonPer, s.bonuses, s.benefits, s.schedule, s.extra, s.source, s.trust, s.note,
                  req.user.fio || req.user.login, nowIso, period.name
                ]
              });
            }
```

на:

```javascript
            if (sid) {
              gStmts.push({
                sql: `UPDATE surveys
                      SET company = ?, pos_our = ?, pos_their = ?, grade = ?, pay_from = ?, pay_to = ?, cur = ?, pay_per = ?,
                          bon_has = ?, bon_size = ?, bon_type = ?, bon_per = ?, bonuses = ?, benefits = ?, schedule = ?, extra = ?, source = ?, trust = ?, note = ?
                      WHERE sid = ? AND unit = ? AND period_id = ?`,
                args: [
                  s.company, s.posOur, s.posTheir, s.grade, s.pFrom, s.pTo, s.cur, s.payPer,
                  s.bonHas, s.bonSize, s.bonType, s.bonPer, s.bonuses, s.benefits, s.schedule, s.extra, s.source, s.trust, s.note,
                  sid, gu, period.id
                ]
              });
            } else {
              const newSid = newRowId('s');
              gStmts.push({
                sql: `INSERT INTO surveys (sid, unit, company, pos_our, pos_their, grade, pay_from, pay_to, cur, pay_per, bon_has, bon_size, bon_type, bon_per, bonuses, benefits, schedule, extra, source, trust, note, created_by, created_at, state, period, period_id)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'активна', ?, ?)`,
                args: [
                  newSid, gu, s.company, s.posOur, s.posTheir, s.grade, s.pFrom, s.pTo, s.cur, s.payPer,
                  s.bonHas, s.bonSize, s.bonType, s.bonPer, s.bonuses, s.benefits, s.schedule, s.extra, s.source, s.trust, s.note,
                  req.user.fio || req.user.login, nowIso, period.name, period.id
                ]
              });
            }
```

- [ ] **Step 4: Обычная (не групповая) ветка — ownership lookup, remove, update, insert**

Строка 465-467, заменить:

```javascript
      const existing = await queryAll(
        `SELECT sid, company, created_by, source FROM surveys WHERE unit = ? AND sid IN (${placeholders})`,
        [unit, ...touchedSids]);
```

на:

```javascript
      const existing = await queryAll(
        `SELECT sid, company, created_by, source FROM surveys WHERE unit = ? AND sid IN (${placeholders}) AND period_id = ?`,
        [unit, ...touchedSids, period.id]);
```

Строки 479-482 (удаление), заменить:

```javascript
        stmts.push({
          sql: "UPDATE surveys SET state = 'удалена' WHERE sid = ? AND unit = ?",
          args: [sid, unit]
        });
```

на:

```javascript
        stmts.push({
          sql: "UPDATE surveys SET state = 'удалена' WHERE sid = ? AND unit = ? AND period_id = ?",
          args: [sid, unit, period.id]
        });
```

Строки 496-508 (обновление существующей строки), заменить:

```javascript
        stmts.push({
          sql: `UPDATE surveys
                SET company = ?, pos_our = ?, pos_their = ?, grade = ?, pay_from = ?, pay_to = ?, cur = ?, pay_per = ?,
                    bon_has = ?, bon_size = ?, bon_type = ?, bon_per = ?, bonuses = ?, benefits = ?, schedule = ?, extra = ?, source = ?, trust = ?, note = ?
                WHERE sid = ? AND unit = ?`,
          args: [
            s.company, s.posOur, s.posTheir, s.grade,
            s.pFrom, s.pTo, s.cur, s.payPer,
            s.bonHas, s.bonSize, s.bonType, s.bonPer, s.bonuses,
            s.benefits, s.schedule, s.extra, s.source, s.trust, s.note,
            sid, unit
          ]
        });
```

на:

```javascript
        stmts.push({
          sql: `UPDATE surveys
                SET company = ?, pos_our = ?, pos_their = ?, grade = ?, pay_from = ?, pay_to = ?, cur = ?, pay_per = ?,
                    bon_has = ?, bon_size = ?, bon_type = ?, bon_per = ?, bonuses = ?, benefits = ?, schedule = ?, extra = ?, source = ?, trust = ?, note = ?
                WHERE sid = ? AND unit = ? AND period_id = ?`,
          args: [
            s.company, s.posOur, s.posTheir, s.grade,
            s.pFrom, s.pTo, s.cur, s.payPer,
            s.bonHas, s.bonSize, s.bonType, s.bonPer, s.bonuses,
            s.benefits, s.schedule, s.extra, s.source, s.trust, s.note,
            sid, unit, period.id
          ]
        });
```

Строки 513-523 (вставка новой строки), заменить:

```javascript
        stmts.push({
          sql: `INSERT INTO surveys (sid, unit, company, pos_our, pos_their, grade, pay_from, pay_to, cur, pay_per, bon_has, bon_size, bon_type, bon_per, bonuses, benefits, schedule, extra, source, trust, note, created_by, created_at, state, period)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'активна', ?)`,
          args: [
            sid, unit, s.company, s.posOur, s.posTheir, s.grade,
            s.pFrom, s.pTo, s.cur, s.payPer,
            s.bonHas, s.bonSize, s.bonType, s.bonPer, s.bonuses,
            s.benefits, s.schedule, s.extra, s.source, s.trust, s.note,
            req.user.fio || req.user.login, now, period.name
          ]
        });
```

на:

```javascript
        stmts.push({
          sql: `INSERT INTO surveys (sid, unit, company, pos_our, pos_their, grade, pay_from, pay_to, cur, pay_per, bon_has, bon_size, bon_type, bon_per, bonuses, benefits, schedule, extra, source, trust, note, created_by, created_at, state, period, period_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'активна', ?, ?)`,
          args: [
            sid, unit, s.company, s.posOur, s.posTheir, s.grade,
            s.pFrom, s.pTo, s.cur, s.payPer,
            s.bonHas, s.bonSize, s.bonType, s.bonPer, s.bonuses,
            s.benefits, s.schedule, s.extra, s.source, s.trust, s.note,
            req.user.fio || req.user.login, now, period.name, period.id
          ]
        });
```

- [ ] **Step 5: Скрипт проверки — новая анкета в «прошлом» периоде не находится в «новом»**

Создать `scratch/verify_task2_survey_period.js`:

```javascript
'use strict';
// Разовая проверка Задачи 2. Запуск: node scratch/verify_task2_survey_period.js
// Создаёт тестовый период и тестовую анкету, проверяет что при переключении
// на другой (реальный текущий) период старая анкета не находится по sid,
// затем удаляет свои тестовые строки.

const { queryOne, queryAll, run } = require('../src/db/database');
const { migrate } = require('../src/db/migrate');

const TEST_UNIT = 'ЭЭЭ_ТЕСТ_period_qa';
const TEST_SID = 'ЭЭЭ_ТЕСТ_sid_period_qa';

(async () => {
  await migrate();

  // Тестовый "прошлый" период — не трогаем реальные periods.state.
  const oldPeriod = await run(
    "INSERT INTO periods (name, state, updated_by, updated_at) VALUES ('ТЕСТ старый год', 'закрыт', 'qa', CURRENT_TIMESTAMP)"
  );
  const oldPeriodId = Number(oldPeriod.lastInsertRowid);

  const realCurrent = await queryOne('SELECT id FROM periods ORDER BY id DESC LIMIT 1');
  if (realCurrent.id === oldPeriodId) throw new Error('FAIL: тестовый период стал текущим — тест некорректен');

  try {
    // Анкета в "старом" тестовом периоде.
    await run(
      `INSERT INTO surveys (sid, unit, company, pos_our, pay_from, pay_to, cur, pay_per, created_by, created_at, state, period, period_id)
       VALUES (?, ?, 'ТЕСТ Компания', 'ТЕСТ Должность', 1000, 2000, 'сомони', 'в месяц', 'qa', CURRENT_TIMESTAMP, 'активна', 'ТЕСТ старый год', ?)`,
      [TEST_SID, TEST_UNIT, oldPeriodId]
    );

    // Ищем эту строку как это делает saveSurveyDetails — с фильтром по РЕАЛЬНОМУ текущему периоду.
    const found = await queryAll(
      'SELECT sid FROM surveys WHERE unit = ? AND sid IN (?) AND period_id = ?',
      [TEST_UNIT, TEST_SID, realCurrent.id]
    );
    if (found.length !== 0) {
      throw new Error('FAIL: анкета из прошлого периода нашлась под текущим periodId — форма не будет чистой');
    }

    // И находится, если фильтровать её же периодом (INSERT/ветка не сломана).
    const foundOwn = await queryAll(
      'SELECT sid FROM surveys WHERE unit = ? AND sid IN (?) AND period_id = ?',
      [TEST_UNIT, TEST_SID, oldPeriodId]
    );
    if (foundOwn.length !== 1) {
      throw new Error('FAIL: анкета не находится в своём собственном периоде');
    }

    console.log('OK: анкета прошлого периода не видна под текущим period_id, но видна под своим');
  } finally {
    await run('DELETE FROM surveys WHERE sid = ?', [TEST_SID]);
    await run('DELETE FROM periods WHERE id = ?', [oldPeriodId]);
  }
  process.exit(0);
})().catch(err => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 6: Запустить проверку**

```bash
cd "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis" && node scratch/verify_task2_survey_period.js
```

Ожидается: `OK: анкета прошлого периода не видна под текущим period_id, но видна под своим`.

- [ ] **Step 7: Прибрать и закоммитить**

```bash
rm scratch/verify_task2_survey_period.js
git add src/controllers/surveyController.js
git commit -m "feat(анкета): сохранение анкеты учитывает период сбора (period_id)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Форма подгружает только анкеты текущего периода

**Files:**
- Modify: `src/controllers/authController.js`

**Interfaces:**
- Consumes: `surveys.period_id` (Task 1), `getPeriodInfo()` возвращает `id` (этот таск сам это добавляет — см. Step 1).
- Produces: `getUserPayload(user).period.id` — используется Задачей 6/7 на фронте. Все анкеты, которые видит форма заполнения, принадлежат текущему периоду.

- [ ] **Step 1: `getPeriodInfo()` возвращает `id`**

Строки 117-127, заменить:

```javascript
async function getPeriodInfo() {
  const p = await queryOne('SELECT * FROM periods ORDER BY id DESC LIMIT 1');
  return p ? {
    name: p.name,
    state: p.state,
    from: p.from_date || '',
    to: p.to_date || '',
    by: p.updated_by || '',
    at: p.updated_at || ''
  } : { name: 'Обзор рынка', state: 'открыт' };
}
```

на:

```javascript
async function getPeriodInfo() {
  const p = await queryOne('SELECT * FROM periods ORDER BY id DESC LIMIT 1');
  return p ? {
    id: p.id,
    name: p.name,
    state: p.state,
    from: p.from_date || '',
    to: p.to_date || '',
    by: p.updated_by || '',
    at: p.updated_at || ''
  } : { id: null, name: 'Обзор рынка', state: 'открыт' };
}
```

- [ ] **Step 2: Резолвить `period` ДО параллельного блока, убрать его из общего `Promise.all`**

Строки 156-200 сейчас выглядят так (сокращённо — важные строки 156-168, 196):

```javascript
  const [
    allUnits,
    compRows,
    survRows,
    dictCompanies,
    dictPositionsRows,
    segRows,
    regRows,
    customSegments,
    customRegions,
    period,
    roleCaps
  ] = await Promise.all([
    cached('divisions', ...),
    queryAll('SELECT unit, actual FROM competitors'),
    queryAll("SELECT unit FROM surveys WHERE state != 'удалена'"),
    ...
    cached('period', () => getPeriodInfo(), 30 * 1000),
    (user.role === 'admin') ? ... : ...
  ]);
```

`survRows` (третий запрос) должен фильтроваться по `period.id`, но `period` сам ещё не готов внутри этого же `Promise.all`. Решение: резолвить `period` ДО этого блока (используем тот же `cached()`, так что повторный вызов почти всегда попадёт в кэш и не добавит сетевого раунда), убрать его из списка промисов и из деструктуризации, использовать `period.id` в запросе `survRows`.

Заменить блок (строки 156-200) на:

```javascript
  const period = await cached('period', () => getPeriodInfo(), 30 * 1000);

  const [
    allUnits,
    compRows,
    survRows,
    dictCompanies,
    dictPositionsRows,
    segRows,
    regRows,
    customSegments,
    customRegions,
    roleCaps
  ] = await Promise.all([
    cached('divisions', async () => {
      try {
        return await queryAll("SELECT unit, dir, COALESCE(group_key,'') AS group_key, COALESCE(survey_note,'') AS survey_note FROM divisions ORDER BY num ASC, unit ASC");
      } catch (e) {
        try {
          return (await queryAll("SELECT unit, dir, COALESCE(group_key,'') AS group_key FROM divisions ORDER BY num ASC, unit ASC")).map(d => ({ ...d, survey_note: '' }));
        } catch (e2) {
          return (await queryAll('SELECT unit, dir FROM divisions ORDER BY num ASC, unit ASC')).map(d => ({ ...d, group_key: '', survey_note: '' }));
        }
      }
    }),
    queryAll('SELECT unit, actual FROM competitors'),
    queryAll("SELECT unit FROM surveys WHERE state != 'удалена' AND period_id = ?", [period.id]),
    cached('dictCompanies', () => withDirs(
      "SELECT name, segment, region, COALESCE(dirs, '') AS dirs FROM dictionary_companies ORDER BY name ASC",
      'SELECT name, segment, region FROM dictionary_companies ORDER BY name ASC'
    )),
    cached('dictPositions', () => withDirs(
      "SELECT name, COALESCE(dirs, '') AS dirs FROM dictionary_positions ORDER BY name ASC",
      'SELECT name FROM dictionary_positions ORDER BY name ASC'
    )),
    cached('segments', () => queryAll(`SELECT DISTINCT TRIM(segment) AS v FROM dictionary_companies WHERE TRIM(COALESCE(segment,'')) <> ''
              UNION SELECT DISTINCT TRIM(segment) FROM competitors WHERE TRIM(COALESCE(segment,'')) <> '' ORDER BY v`)),
    cached('regions', () => queryAll(`SELECT DISTINCT TRIM(region) AS v FROM dictionary_companies WHERE TRIM(COALESCE(region,'')) <> ''
              UNION SELECT DISTINCT TRIM(region) FROM competitors WHERE TRIM(COALESCE(region,'')) <> '' ORDER BY v`)),
    cached('customSegments', () => safeNames('dictionary_segments')),
    cached('customRegions', () => safeNames('dictionary_regions')),
    (user.role === 'admin')
      ? Promise.resolve([])
      : cached('roleCaps:' + user.role, () => queryAll('SELECT capability FROM role_capabilities WHERE role = ?', [user.role]).catch(() => []))
  ]);
```

(Единственные содержательные изменения: `period` вынесен наружу и резолвится первым; `survRows` получил `AND period_id = ?`; `cached('period', ...)` убран из списка промисов и из деструктуризации — 9 элементов вместо 10.)

- [ ] **Step 3: `userSurveysPromise` — только текущий период**

Строки 266-268, заменить:

```javascript
  const userSurveysPromise = (myUnits.length > 0)
    ? queryAll(`SELECT * FROM surveys WHERE unit IN (${myUnits.map(() => '?').join(',')}) AND state != 'удалена'`, myUnits)
    : Promise.resolve([]);
```

на:

```javascript
  const userSurveysPromise = (myUnits.length > 0)
    ? queryAll(`SELECT * FROM surveys WHERE unit IN (${myUnits.map(() => '?').join(',')}) AND state != 'удалена' AND period_id = ?`, [...myUnits, period.id])
    : Promise.resolve([]);
```

- [ ] **Step 4: Смежные группы — только текущий период**

Строки 299-303, заменить:

```javascript
        const [posRows, compRowsGroup, survRowsGroup] = await Promise.all([
          queryAll(`SELECT unit, position FROM unit_positions WHERE unit IN (${up})`, unitsInGroup),
          queryAll(`SELECT unit, company FROM competitors WHERE unit IN (${up})`, unitsInGroup),
          queryAll(`SELECT * FROM surveys WHERE unit IN (${up}) AND state != 'удалена'`, unitsInGroup)
        ]);
```

на:

```javascript
        const [posRows, compRowsGroup, survRowsGroup] = await Promise.all([
          queryAll(`SELECT unit, position FROM unit_positions WHERE unit IN (${up})`, unitsInGroup),
          queryAll(`SELECT unit, company FROM competitors WHERE unit IN (${up})`, unitsInGroup),
          queryAll(`SELECT * FROM surveys WHERE unit IN (${up}) AND state != 'удалена' AND period_id = ?`, [...unitsInGroup, period.id])
        ]);
```

- [ ] **Step 5: Скрипт проверки**

Создать `scratch/verify_task3_form_load.js` — по аналогии со Step 5 Задачи 2, но вызывающий саму `getUserPayload` (экспортировать её временно для скрипта не нужно — проще напрямую воспроизвести SQL, как в Задаче 2, применительно к `userSurveysPromise`):

```javascript
'use strict';
// Разовая проверка Задачи 3. Запуск: node scratch/verify_task3_form_load.js

const { queryOne, run } = require('../src/db/database');
const { migrate } = require('../src/db/migrate');

const TEST_UNIT = 'ЭЭЭ_ТЕСТ_form_load_qa';
const TEST_SID = 'ЭЭЭ_ТЕСТ_sid_form_load_qa';

(async () => {
  await migrate();

  const oldPeriod = await run(
    "INSERT INTO periods (name, state, updated_by, updated_at) VALUES ('ТЕСТ старый год 2', 'закрыт', 'qa', CURRENT_TIMESTAMP)"
  );
  const oldPeriodId = Number(oldPeriod.lastInsertRowid);
  const realCurrent = await queryOne('SELECT id FROM periods ORDER BY id DESC LIMIT 1');

  try {
    await run(
      `INSERT INTO surveys (sid, unit, company, pos_our, pay_from, pay_to, cur, pay_per, created_by, created_at, state, period, period_id)
       VALUES (?, ?, 'ТЕСТ Компания 2', 'ТЕСТ Должность 2', 1000, 2000, 'сомони', 'в месяц', 'qa', CURRENT_TIMESTAMP, 'активна', 'ТЕСТ старый год 2', ?)`,
      [TEST_SID, TEST_UNIT, oldPeriodId]
    );

    // То же условие, что теперь использует userSurveysPromise (Step 3 Задачи 3).
    const { queryAll } = require('../src/db/database');
    const rowsForCurrentUser = await queryAll(
      `SELECT * FROM surveys WHERE unit IN (?) AND state != 'удалена' AND period_id = ?`,
      [TEST_UNIT, realCurrent.id]
    );
    if (rowsForCurrentUser.length !== 0) {
      throw new Error('FAIL: анкета прошлого периода попала бы в форму текущего периода');
    }
    console.log('OK: форма для текущего периода не получит анкету прошлого года');
  } finally {
    await run('DELETE FROM surveys WHERE sid = ?', [TEST_SID]);
    await run('DELETE FROM periods WHERE id = ?', [oldPeriodId]);
  }
  process.exit(0);
})().catch(err => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 6: Запустить проверку**

```bash
cd "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis" && node scratch/verify_task3_form_load.js
```

Ожидается: `OK: форма для текущего периода не получит анкету прошлого года`.

- [ ] **Step 7: Прибрать и закоммитить**

```bash
rm scratch/verify_task3_form_load.js
git add src/controllers/authController.js
git commit -m "feat(анкета): форма загружает анкеты только текущего периода сбора

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Открытие периода сбрасывает актуальность конкурентов

**Files:**
- Modify: `src/controllers/adminController.js:790-802`
- Create: `scratch/verify_task4_reset_actual.js`

**Interfaces:**
- Produces: при `setPeriod({state:'открыт', ...})` выполняется `UPDATE competitors SET actual = 'уточнить'` для ВСЕХ строк (не только для тестовых — сама эта логика идёт в прод-код без ограничения; проверка ниже тестирует SQL на отдельно вставленных тестовых строках, не трогая реальные).

- [ ] **Step 1: Добавить сброс актуальности при открытии периода**

В `src/controllers/adminController.js`, строки 790-802, заменить:

```javascript
  try {
    await run(`
      INSERT INTO periods (name, state, from_date, to_date, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [cleanName, cleanState, from || null, to || null, req.user.fio || req.user.login]);

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'период сбора',
      `Период: ${cleanName}, Статус: ${cleanState}`
    ]);
```

на:

```javascript
  try {
    await run(`
      INSERT INTO periods (name, state, from_date, to_date, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [cleanName, cleanState, from || null, to || null, req.user.fio || req.user.login]);

    // Новый год сбора — «чистый лист» по актуальности конкурентов: старые
    // отметки «актуально»/«не актуально» могли устареть за год, HR BP должны
    // перепроверить каждую заново. Сами анкеты (surveys) не трогаем — они
    // просто перестают быть «текущим периодом» за счёт period_id (см.
    // surveyController.saveSurveyDetails и authController.getUserPayload).
    if (cleanState === 'открыт') {
      await run("UPDATE competitors SET actual = 'уточнить'");
    }

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'период сбора',
      `Период: ${cleanName}, Статус: ${cleanState}` + (cleanState === 'открыт' ? ' (актуальность конкурентов сброшена)' : '')
    ]);
```

- [ ] **Step 2: Скрипт проверки SQL на тестовых строках (не трогая реальных конкурентов)**

Создать `scratch/verify_task4_reset_actual.js`:

```javascript
'use strict';
// Разовая проверка Задачи 4. Запуск: node scratch/verify_task4_reset_actual.js
// НЕ вызывает реальный /api/admin/period (это затронуло бы ВСЕХ реальных
// конкурентов в общей базе) — проверяет тот же SQL-паттерн на двух заведомо
// тестовых строках, затем удаляет их.

const { queryAll, run } = require('../src/db/database');

const TEST_CID_1 = 'ЭЭЭ_ТЕСТ_cid_reset_1';
const TEST_CID_2 = 'ЭЭЭ_ТЕСТ_cid_reset_2';

(async () => {
  await run(
    `INSERT INTO competitors (cid, unit, company, actual) VALUES (?, 'ЭЭЭ_ТЕСТ_unit', 'ТЕСТ Конкурент 1', 'актуально')`,
    [TEST_CID_1]
  );
  await run(
    `INSERT INTO competitors (cid, unit, company, actual) VALUES (?, 'ЭЭЭ_ТЕСТ_unit', 'ТЕСТ Конкурент 2', 'не актуально')`,
    [TEST_CID_2]
  );

  try {
    // Тот же паттерн запроса, что теперь выполняет setPeriod при открытии —
    // здесь сознательно ограничен WHERE cid IN (...), чтобы не задеть реальные
    // строки; в проде (adminController.js) ограничения нет — там по всей таблице.
    await run(
      `UPDATE competitors SET actual = 'уточнить' WHERE cid IN (?, ?)`,
      [TEST_CID_1, TEST_CID_2]
    );

    const rows = await queryAll(
      'SELECT cid, actual FROM competitors WHERE cid IN (?, ?)',
      [TEST_CID_1, TEST_CID_2]
    );
    const allReset = rows.length === 2 && rows.every(r => r.actual === 'уточнить');
    if (!allReset) throw new Error('FAIL: не все тестовые строки сброшены на "уточнить": ' + JSON.stringify(rows));

    console.log('OK: UPDATE ... SET actual = \'уточнить\' корректно сбрасывает статус');
  } finally {
    await run('DELETE FROM competitors WHERE cid IN (?, ?)', [TEST_CID_1, TEST_CID_2]);
  }
  process.exit(0);
})().catch(err => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 3: Запустить проверку**

```bash
cd "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis" && node scratch/verify_task4_reset_actual.js
```

Ожидается: `OK: UPDATE ... SET actual = 'уточнить' корректно сбрасывает статус`.

Реальный полный прогон (`UPDATE competitors SET actual = 'уточнить'` без ограничения, через настоящую кнопку в админке) сознательно НЕ выполняется здесь — это действие на общей боевой базе, см. Задачу 8.

- [ ] **Step 4: Прибрать и закоммитить**

```bash
rm scratch/verify_task4_reset_actual.js
git add src/controllers/adminController.js
git commit -m "feat(период): открытие нового периода сбрасывает актуальность конкурентов

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Дашборд — фильтр по году и список периодов

**Files:**
- Modify: `src/services/analyticsService.js`
- Modify: `test/analyticsService.test.js` (создать — в проекте такого файла ещё нет, но `bonuses.test.js` уже импортирует из `analyticsService`, так что модуль тестируем)

**Interfaces:**
- Produces: `resolveDashboardPeriodId(rawFilterValue, currentPeriodId)` — чистая функция, экспортируется из `analyticsService.js`. `getExtendedAnalytics(filters, opts)` принимает `filters.period` (строка id года или `''`/`undefined` для «текущий»), возвращает в результате `periodsList: [{id, name}]` (сначала новые) и `viewingPeriodId: number|null`.
- Consumes: `surveys.period_id` (Task 1).

- [ ] **Step 1: Написать и экспортировать чистую функцию выбора года**

В `src/services/analyticsService.js`, рядом с другими вспомогательными функциями (например, около `calculateSalaryForkStats`, до `getExtendedAnalytics`), добавить:

```javascript
/**
 * Какой period_id показывать на дашборде. Фронт присылает filters.period —
 * пустая строка/undefined значит «текущий год» (по умолчанию), иначе это
 * id конкретного архивного года, выбранного в переключателе.
 */
function resolveDashboardPeriodId(rawFilterValue, currentPeriodId) {
  const n = parseInt(rawFilterValue, 10);
  if (Number.isFinite(n) && n > 0) return n;
  return currentPeriodId || null;
}
```

И добавить в блок экспортов в конце файла (там же, где сейчас `normPeriod,` — строка 671):

```javascript
  resolveDashboardPeriodId,
```

- [ ] **Step 2: Тест чистой функции**

Создать `test/analyticsService.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveDashboardPeriodId } = require('../src/services/analyticsService');

test('resolveDashboardPeriodId: пустая строка → текущий период', () => {
  assert.equal(resolveDashboardPeriodId('', 5), 5);
});

test('resolveDashboardPeriodId: undefined → текущий период', () => {
  assert.equal(resolveDashboardPeriodId(undefined, 5), 5);
});

test('resolveDashboardPeriodId: явный id → используется он', () => {
  assert.equal(resolveDashboardPeriodId('3', 5), 3);
});

test('resolveDashboardPeriodId: мусорная строка → текущий период', () => {
  assert.equal(resolveDashboardPeriodId('abc', 7), 7);
});

test('resolveDashboardPeriodId: нет текущего периода и явного id → null', () => {
  assert.equal(resolveDashboardPeriodId(undefined, null), null);
});

test('resolveDashboardPeriodId: id=0 или отрицательный — не валиден, фолбэк на текущий', () => {
  assert.equal(resolveDashboardPeriodId('0', 5), 5);
  assert.equal(resolveDashboardPeriodId('-1', 5), 5);
});
```

- [ ] **Step 3: Запустить тест и убедиться, что он проходит**

```bash
cd "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis" && node --test test/analyticsService.test.js
```

Ожидается: все 6 тестов PASS.

- [ ] **Step 4: Подключить фильтр к основному запросу дашборда**

В `src/services/analyticsService.js`, `getExtendedAnalytics` (строка 237), заменить начало функции (строки 237-258):

```javascript
async function getExtendedAnalytics(filters = {}, opts = {}) {
  const filterDir = (filters.dir || '').trim();
  const filterHrbp = (filters.hrbp || '').trim();
  const filterRegion = (filters.region || '').trim();
  const searchPos = (filters.search || '').trim().toLowerCase();

  // Ограничение видимости по роли: для не-admin/cb дашборд и весь его расчёт
  // (вилки, медиана рынка, реестр) считаются только по доступным пользователю
  // подразделениям. Предикат по строке divisions приходит из контроллера.
  const unitFilter = typeof opts.unitFilter === 'function' ? opts.unitFilter : null;

  // Параллельный запуск всех запросов к БД в 1 сетевом раунде
  const [divisionsRaw, competitors, surveys, posDict] = await Promise.all([
    // region добавлена миграцией; на не мигрированной базе колонки может не быть.
    queryAll("SELECT num, dir, unit, head, resp, hrbp, COALESCE(region,'') AS region FROM divisions")
      .catch(() => queryAll('SELECT num, dir, unit, head, resp, hrbp FROM divisions')
        .then(rows => rows.map(r => ({ ...r, region: '' })))),
    queryAll('SELECT unit, actual FROM competitors'),
    queryAll("SELECT * FROM surveys WHERE state != 'удалена'"),
    queryAll('SELECT name, COALESCE(pay_from,0) AS pay_from, COALESCE(pay_to,0) AS pay_to FROM dictionary_positions')
      .catch(() => [])
  ]);
```

на:

```javascript
async function getExtendedAnalytics(filters = {}, opts = {}) {
  const filterDir = (filters.dir || '').trim();
  const filterHrbp = (filters.hrbp || '').trim();
  const filterRegion = (filters.region || '').trim();
  const searchPos = (filters.search || '').trim().toLowerCase();

  // Ограничение видимости по роли: для не-admin/cb дашборд и весь его расчёт
  // (вилки, медиана рынка, реестр) считаются только по доступным пользователю
  // подразделениям. Предикат по строке divisions приходит из контроллера.
  const unitFilter = typeof opts.unitFilter === 'function' ? opts.unitFilter : null;

  // Годовой архив: без явного filters.period дашборд показывает последний
  // (текущий) период — periodsList уходит на фронт для выпадающего списка.
  const periodsList = await queryAll('SELECT id, name FROM periods ORDER BY id DESC');
  const currentPeriodId = periodsList.length ? periodsList[0].id : null;
  const viewingPeriodId = resolveDashboardPeriodId(filters.period, currentPeriodId);

  // Параллельный запуск всех запросов к БД в 1 сетевом раунде
  const [divisionsRaw, competitors, surveys, posDict] = await Promise.all([
    // region добавлена миграцией; на не мигрированной базе колонки может не быть.
    queryAll("SELECT num, dir, unit, head, resp, hrbp, COALESCE(region,'') AS region FROM divisions")
      .catch(() => queryAll('SELECT num, dir, unit, head, resp, hrbp FROM divisions')
        .then(rows => rows.map(r => ({ ...r, region: '' })))),
    queryAll('SELECT unit, actual FROM competitors'),
    viewingPeriodId
      ? queryAll("SELECT * FROM surveys WHERE state != 'удалена' AND period_id = ?", [viewingPeriodId])
      : queryAll("SELECT * FROM surveys WHERE state != 'удалена'"),
    queryAll('SELECT name, COALESCE(pay_from,0) AS pay_from, COALESCE(pay_to,0) AS pay_to FROM dictionary_positions')
      .catch(() => [])
  ]);
```

- [ ] **Step 5: Вернуть `periodsList`/`viewingPeriodId` в результате**

Найти в этом же файле блок финального `return` (строки 619-660, где уже читается `periodRow` — `const periodRow = (await queryOne('SELECT * FROM periods ORDER BY id DESC LIMIT 1')) || { name: 'Обзор рынка', state: 'открыт' };` и ниже `period: { name: periodRow.name, ... }`). Внутрь возвращаемого объекта, рядом с существующим `period:` полем, добавить:

```javascript
    periodsList: periodsList.map(p => ({ id: p.id, name: p.name })),
    viewingPeriodId,
```

(Существующее поле `period` — это всегда «реальный текущий период», для бейджа открыт/закрыт; `viewingPeriodId`/`periodsList` — отдельно, для переключателя года. Оставить оба, не сливать.)

- [ ] **Step 6: Проверить, что существующие тесты не сломались**

```bash
cd "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis" && node --test
```

Ожидается: все тесты (включая `bonuses.test.js`, который уже импортирует из `analyticsService.js`) проходят.

- [ ] **Step 7: Закоммитить**

```bash
git add src/services/analyticsService.js test/analyticsService.test.js
git commit -m "feat(дашборд): фильтр по году сбора (period_id) в аналитике

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Переключатель года на дашборде (фронт)

**Files:**
- Modify: `public/app-core.js:114` (дефолт `dashFilters`)
- Modify: `public/app.js` (панель фильтров дашборда, строки ~3238-3306)

**Interfaces:**
- Consumes: `d.periodsList`, `d.viewingPeriodId` из ответа `apiCBDashboardExtended` (Task 5).
- Produces: видимый выпадающий список года рядом с остальными фильтрами дашборда; выбор года кладёт id в `S.dashFilters.period` и перезапрашивает дашборд.

- [ ] **Step 1: Добавить `period` в дефолтные фильтры**

В `public/app-core.js:114`, заменить:

```javascript
  dashFilters:{ dir:'', hrbp:'', region:'', search:'' },
```

на:

```javascript
  dashFilters:{ dir:'', hrbp:'', region:'', search:'', period:'' },
```

(Пустая строка = «текущий год», как и остальные фильтры с «Все…».)

- [ ] **Step 2: Добавить выпадающий список года в панель фильтров**

В `public/app.js`, строки 3246-3255, заменить:

```javascript
  h += '<div id="dashFilterBar" class="toolbar dash-filters"'+(filterHidden ? ' style="display:none"' : '')+'>'+
    niceSelect({ id:'dashDir', value:S.dashFilters.dir, width:190,
      items:[{ v:'', label:'Все направления' }].concat(allDirs.map(function(dir){ return { v:dir, label:dir }; })) })+
    niceSelect({ id:'dashHrbp', value:S.dashFilters.hrbp, width:180,
      items:[{ v:'', label:'Все HR BP' }].concat(allHrbps.map(function(x){ return { v:x, label:x }; })) })+
    (allRegions.length ? niceSelect({ id:'dashRegion', value:S.dashFilters.region, width:170,
      items:[{ v:'', label:'Все регионы' }].concat(allRegions.map(function(x){ return { v:x, label:x }; })) }) : '')+
    '<button id="btnDashReset" class="btn-ghost dash-filter-reset">Сбросить</button>'+
    '<button id="btnDashExport" class="btn-line dash-filter-export">'+ic('download', 14)+'<span class="dash-exp-txt">Экспорт в CSV</span></button>'+
  '</div>';
```

на:

```javascript
  var periodsList = d.periodsList || [];
  h += '<div id="dashFilterBar" class="toolbar dash-filters"'+(filterHidden ? ' style="display:none"' : '')+'>'+
    (periodsList.length > 1 ? niceSelect({ id:'dashPeriod', value:S.dashFilters.period || String(d.viewingPeriodId || ''), width:200,
      items: periodsList.map(function(p){ return { v:String(p.id), label:p.name }; }) }) : '')+
    niceSelect({ id:'dashDir', value:S.dashFilters.dir, width:190,
      items:[{ v:'', label:'Все направления' }].concat(allDirs.map(function(dir){ return { v:dir, label:dir }; })) })+
    niceSelect({ id:'dashHrbp', value:S.dashFilters.hrbp, width:180,
      items:[{ v:'', label:'Все HR BP' }].concat(allHrbps.map(function(x){ return { v:x, label:x }; })) })+
    (allRegions.length ? niceSelect({ id:'dashRegion', value:S.dashFilters.region, width:170,
      items:[{ v:'', label:'Все регионы' }].concat(allRegions.map(function(x){ return { v:x, label:x }; })) }) : '')+
    '<button id="btnDashReset" class="btn-ghost dash-filter-reset">Сбросить</button>'+
    '<button id="btnDashExport" class="btn-line dash-filter-export">'+ic('download', 14)+'<span class="dash-exp-txt">Экспорт в CSV</span></button>'+
  '</div>';
```

Список года показывается, только если реально есть больше одного периода (`periodsList.length > 1`) — на первом годе работы системы (только один период существует) переключатель не нужен и не должен занимать место.

- [ ] **Step 3: Подключить обработчик выбора года**

В `public/app.js`, строки 3294-3296, заменить:

```javascript
  wireNiceSelect('dashDir', function(v){ S.dashFilters.dir = v; fetchDashboard(true); });
  wireNiceSelect('dashHrbp', function(v){ S.dashFilters.hrbp = v; fetchDashboard(true); });
  wireNiceSelect('dashRegion', function(v){ S.dashFilters.region = v; fetchDashboard(true); });
```

на:

```javascript
  wireNiceSelect('dashPeriod', function(v){ S.dashFilters.period = v; fetchDashboard(true); });
  wireNiceSelect('dashDir', function(v){ S.dashFilters.dir = v; fetchDashboard(true); });
  wireNiceSelect('dashHrbp', function(v){ S.dashFilters.hrbp = v; fetchDashboard(true); });
  wireNiceSelect('dashRegion', function(v){ S.dashFilters.region = v; fetchDashboard(true); });
```

(`wireNiceSelect` уже безопасно ничего не делает, если элемента `#dashPeriod` нет в DOM — строка 3167 `if(!root) return;` — поэтому вызывать его безусловно нормально даже когда список года скрыт из-за одного периода.)

Кнопка «Сбросить» (строка 3298-3304) год **не** трогает — это фильтр «в рамках года» (направление/HR BP/регион), а не выбор самого года; менять не нужно.

- [ ] **Step 4: Проверить в браузере**

```bash
cd "C:/Users/Acer/projects/Farovon Market Analysis/Farovon Market Analysis" && npm run dev
```

Открыть дашборд в браузере (см. verification_workflow — preview/browser tools). Пока в базе только один период — переключатель не виден (это ожидаемо, проверяется реально в Задаче 8, когда появится второй период). Проверить, что дашборд по-прежнему открывается и все существующие фильтры (направление/HR BP/регион) работают как раньше — переключатель года не должен был ничего сломать даже при `periodsList.length === 1`.

- [ ] **Step 5: Закоммитить**

```bash
git add public/app-core.js public/app.js
git commit -m "feat(дашборд): переключатель года сбора рядом с фильтрами

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Кнопка «Открыть новый период» скрыта без права `period:edit`

**Files:**
- Modify: `public/app.js:7512-7574` (`renderAdminPeriod`)

**Interfaces:**
- Consumes: `hasCap('period:edit')` (уже существующая функция, `public/app.js:118`).

- [ ] **Step 1: Скрыть обе кнопки действия, если права нет**

В `public/app.js`, `renderAdminPeriod` (строки 7512-7527), заменить:

```javascript
function renderAdminPeriod(){
  var p = S.data.period || {};
  var closed = p.state === 'закрыт';

  var h = '<div class="card period-card">'+
    '<div class="period-card-kicker">Текущий период сбора</div>'+
    '<div class="period-card-name">'+esc(p.name || 'Обзор рынка')+'</div>'+
    '<div class="period-card-meta">'+
      'Статус: <b class="'+(closed?'is-no':'is-ok')+'">'+esc(p.state || 'открыт')+'</b>'+
      (p.from ? ' · с '+esc(p.from) : '') + (p.to ? ' · по '+esc(p.to) : '') +
      (p.by ? '<br>Изменил: <b>'+esc(p.by)+'</b>'+(p.at?' ('+esc(fmtDateTime(p.at))+')':'') : '') +
    '</div>'+
    (closed
      ? '<button id="btnAdminPeriodOpen" class="btn-line period-card-act is-open">Открыть новый период</button>'
      : '<button id="btnAdminPeriodClose" class="btn-line btn-danger period-card-act">Закрыть период сбора</button>')+
  '</div>';

  $('adminContent').innerHTML = h;
```

на:

```javascript
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

Остальная часть функции (обработчики `$('btnAdminPeriodOpen')`/`$('btnAdminPeriodClose')`, строки 7531-7573) не меняется — `if($('btnAdminPeriodOpen'))` уже безопасно ничего не делает, когда кнопки нет в DOM.

- [ ] **Step 2: Проверить в браузере**

Запустить dev-сервер (см. Task 6 Step 4). Зайти под пользователем с ролью, у которой ЕСТЬ `period:edit` (сейчас — `admin`/`hrbp`) → Админка → «Период сбора» → кнопка видна, как раньше. Это единственная реально проверяемая сейчас ветка (обе существующие роли с доступом к вкладке имеют и `period:edit` — см. `src/config/capabilities.js:52`), поэтому «кнопки нет у роли без права» на живых ролях сейчас не воспроизвести — код тем не менее корректен и готов на будущее (если появится роль с `period:view`, но без `period:edit`).

- [ ] **Step 3: Закоммитить**

```bash
git add public/app.js
git commit -m "fix(период): скрывать кнопку открытия/закрытия периода без права period:edit

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Сквозная проверка на реальных данных

⚠️ **СТОП перед этой задачей.** Она требует по-настоящему закрыть и открыть период сбора на общей боевой базе (используется обоими ноутбуками пользователя) — это реально сбросит `actual` у ВСЕХ реальных конкурентов и на время закроет возможность редактирования для всех, кто не admin/hrbp. Прежде чем выполнять любой из шагов ниже, спросить пользователя прямо в чате: «Можно сейчас на пару минут закрыть и снова открыть период сбора на реальной базе, чтобы проверить архив по годам? Оба ноутбука сейчас не редактируют анкеты?» — и дождаться явного «да». Не выполнять автоматически.

**Files:** нет изменений кода — только ручная проверка через браузер.

- [ ] **Step 1: Получить подтверждение пользователя (см. предупреждение выше)**

- [ ] **Step 2: Запомнить/записать текущие цифры «до»**

Открыть дашборд (текущий, единственный пока период), вкладку «По регионам» — записать медиану по одному-двум регионам (например «Худжанд — медиана 4000», как было в разговоре с пользователем) для сверки после.

- [ ] **Step 3: Заполнить тестовую анкету в текущем периоде**

Через обычный интерфейс (не скрипт) зайти в любое подразделение, заполнить/изменить оклад по одной существующей записи на заведомо другое число (например, поставить временно 9999, которое легко отличить), сохранить. Записать, какое подразделение/компанию/должность трогали, чтобы потом вернуть как было.

- [ ] **Step 4: Открыть новый период**

Админка → «Период сбора» → «Закрыть период сбора» → «Открыть новый период» (ввести любое тестовое имя, например «ТЕСТ проверка архива»).

- [ ] **Step 5: Проверить, что форма для той же записи пустая**

Зайти в то же самое подразделение — запись с 9999 не должна быть предзаполнена (поле должно быть пустым/дефолтным для этой должности+компании, как для совсем новой записи).

- [ ] **Step 6: Заполнить другое число, проверить переключатель года на дашборде**

Внести какое-то другое тестовое число (например 5555) в ту же должность/компанию, сохранить. Открыть дашборд → должен появиться выпадающий список года (теперь их два) → переключить на старый год → убедиться, что там видно 9999 (или исходное значение из Step 3, если 9999 не сохранилось отдельной строкой) → переключить на новый год → видно 5555.

- [ ] **Step 7: Откатить тестовые правки**

Вернуть оригинальное значение оклада в записи из Step 3 (в архивном, старом периоде — через ту же форму, но уже понимая, что редактирование архивного года через обычную форму заполнения недоступно: форма всегда работает с текущим периодом). Если запись из Step 3 осталась с изменённым значением в архиве — сообщить пользователю, что тестовое значение осталось в истории старого периода, и уточнить, нужно ли поправить его вручную (прямое изменение чужого периода через форму не предусмотрено по дизайну этой задачи — читай Global Constraints).

- [ ] **Step 8: Итоговый отчёт пользователю**

Сообщить пользователю прямо (простыми словами, с цифрами из Step 2/6): сработало ли разделение по годам как задумано, что именно проверено, и что тестовые данные (если что-то осталось) находятся в архивном периоде «ТЕСТ проверка архива» — предложить решить, оставить ли этот тестовый период в списке или как-то его пометить.

---

## Self-Review (для исполнителя плана)

- **Покрытие спеки:** раздел 1 (схема) → Task 1; раздел 2 (форма без учёта года) → Task 2 + Task 3; раздел 3 (открытие периода → сброс актуальности) → Task 4; раздел 4 (переключатель года) → Task 5 + Task 6; раздел 5 (права на кнопку) → Task 7; раздел «Тестирование» спеки → Tasks 2/3 (скрипты), Task 5 (юнит-тесты), Task 8 (ручная сквозная проверка).
- **Типы/сигнатуры:** `period.id` (из `getPeriodInfo`/`queryOne('SELECT id, ...')`) используется одинаково как `number|null` во всех задачах 2-5. `resolveDashboardPeriodId(rawFilterValue, currentPeriodId) → number|null` — сигнатура одна и та же в Task 5 (определение) и Task 6 (косвенно, через `filters.period` строкой).
- **Открытые риски:** Task 8 — единственная задача, которая требует реального действия на общей боевой базе; явно вынесена в конец и защищена подтверждением пользователя.
