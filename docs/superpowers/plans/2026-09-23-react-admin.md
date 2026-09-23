# План реализации: новый клиент на React, этап 6 (администрирование)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin` — хаб разделов; `/admin/users`, `/admin/divisions`,
`/admin/staff`, `/admin/grading`, `/admin/benchmark`, `/admin/periods` —
шесть административных разделов, каждый со своим правом.

**Architecture:** Сервер почти не меняется — все маршруты, кроме одного
нового (`GET /admin/periods`), уже существуют и покрыты серверными тестами.
Этап преимущественно клиентский, по образцу `features/access/`.

**Tech Stack:** тот же, что в этапах 0–5.

**Spec:** `docs/superpowers/specs/2026-09-23-react-admin-design.md`.

## Global Constraints

Общие для всех этапов. Дополнительно:
- Не трогаем серверную бизнес-логику — только один новый read-маршрут
  (Task 6).
- Не переписываем автоподбор смежных групп (`adjacent-group`) в объёме
  этого плана — если после Task 2 останется время, отдельным шагом; иначе
  явно отметить как отложенное в финальном коммите.
- Не выдумываем текст предупреждений заново там, где он уже есть в старом
  клиенте (`client/app.js`) — искать и переносить формулировку.

## Карта файлов (клиент)

- `web/src/api/admin.ts`, `web/src/api/periods.ts`, дополнения в `web/src/api/contract.ts`
- `web/src/design/FileInput.tsx` + css
- `web/src/features/admin/AdminHub.tsx` + css
- `web/src/features/admin/users/{UsersScreen,UserForm}.tsx`, `useUsers.ts` + css
- `web/src/features/admin/divisions/{DivisionsScreen,DivisionForm,BatchAssignForm}.tsx`, `useDivisions.ts` + css
- `web/src/features/admin/staff/{StaffScreen,StaffImportWizard}.tsx`, `useStaff.ts` + css
- `web/src/features/admin/grading/{GradingAdminScreen,FactorsTab,BlocksTab,CommitteeTab}.tsx`, `useGradingAdmin.ts` + css
- `web/src/features/admin/benchmark/{BenchmarkAdminScreen,SourcesTab,BenchmarkImportWizard,MappingTab,DatasetsTab}.tsx`, `useBenchmarkAdmin.ts` + css
- `web/src/features/admin/periods/{PeriodsScreen,PeriodForm,PeriodGrantsPanel}.tsx`, `usePeriods.ts` + css
- `web/src/app/routes.tsx`, `web/src/features/shell/NavItems.ts`
- `src/controllers/adminController.js`, `src/routes/api.js` (Task 6 только)

---

### Task 1: Хаб `/admin` и раздел «Пользователи»

**Files:**
- Create: `web/src/api/admin.ts`, `web/src/features/admin/AdminHub.tsx` + css + тест,
  `web/src/features/admin/users/*` + тесты
- Modify: `web/src/api/contract.ts` (`AdminUser`, `SaveUserPayload`,
  `ResetPasswordResponse`), `web/src/app/routes.tsx`, `web/src/features/shell/NavItems.ts` (+ тест, пункт «Администрирование»)

**Interfaces:**
- Produces: `adminApi.users()`, `.saveUser(payload)`, `.toggleUser(login, active)`,
  `.resetPassword(login)`, `.usersArchive()`, `.archiveUser(login)`, `.restoreUser(login)`

- [x] **Step 1: Тесты хаба и списка пользователей**

Хаб показывает только карточки разделов, на которые есть право (проверить
на пользователе с одним правом из шести — видна одна карточка + всегда
видна «Роли и доступы» при `role==='admin'`). Таблица пользователей
рендерит роль/статус/подразделения из ответа API; переключатель активности
на выключение требует подтверждения.

- [x] **Step 2: Реализация**

`UserForm` в `Sheet`: создание (без поля логина) и редактирование
(логин по клику на существующую строку). Роли — статический список
`ROLE_LABELS`, либо чтение из уже существующего `web/src/features/access/`
(проверить, экспортирует ли он такой список — переиспользовать, не
дублировать текстовые метки ролей).

- [x] **Step 3: Архив**

Отдельная вкладка/переключатель в `UsersScreen` — список из
`usersArchive()`, кнопка «Восстановить».

- [x] **Step 4: Прогнать, вручную на dev-данных (создать тестового
  пользователя, выключить/включить, сбросить пароль — проверить реакцию
  на отсутствие Telegram), commit**

```bash
git add web/src
git commit -m "feat(web): раздел «Администрирование» — хаб и управление пользователями"
```

---

### Task 2: Раздел «Оргструктура»

**Files:** Create: `web/src/features/admin/divisions/*` + тесты, `useDivisions.ts`, css
Modify: `web/src/api/admin.ts`, `web/src/api/contract.ts` (`Division`,
`SaveDivisionPayload`), `web/src/app/routes.tsx`, `NavItems.ts`

**Interfaces:** Consumes: `GET /admin/divisions` (форма ответа зависит от
роли — `dir_head`/`head` получают уже отфильтрованный список, клиент не
фильтрует повторно).

- [x] **Step 1: Тесты**

Для роли не-admin/cb поля `dir`/`group`/`region`/`org_role`/
`is_survey_target` отображаются как `disabled`, а не скрыты. Кнопка
«Создать»/«Удалить»/«Массовое назначение» видны только admin/cb.

- [x] **Step 2: Реализация CRUD + перемещение**

Таблица + `DivisionForm` в `Sheet`. Ошибка `delete` (юнит используется)
показывается текстом сервера как есть, не переформулируется.

- [x] **Step 3: Массовое назначение по направлению**

`BatchAssignForm` — направление + поле (`head`/`hrbp`/`resp`) + значение.

- [x] **Step 4: Прогнать, вручную (создать/переместить/скрыть тестовый
  юнит на dev-данных), commit**

```bash
git add web/src
git commit -m "feat(web): раздел «Оргструктура» — CRUD, перемещение, массовое назначение"
```

---

### Task 3: Раздел «Справочник сотрудников»

**Files:** Create: `web/src/features/admin/staff/*` + тесты, `useStaff.ts`,
`web/src/design/FileInput.tsx` + css, css
Modify: `web/src/api/admin.ts`, `contract.ts` (`StaffRecord`, `StaffImportReport`)

**Interfaces:** `adminApi.staffDirectory()`, `.saveStaffDirectory(row)`,
`.deleteStaffDirectory(id)`, `.importStaffDirectory(csv, dryRun)`

- [x] **Step 1: Тесты**

Мастер импорта: выбор файла → показывает отчёт dry-run (не отправляет
`dryRun:false` до явного подтверждения) → «Подтвердить» вызывает импорт с
`dryRun:false` и текстом ровно тем же CSV.

- [x] **Step 2: Реализация — таблица + ручное CRUD одной записи**
- [x] **Step 3: Реализация — мастер импорта (dry-run → отчёт → подтвердить)**
- [x] **Step 4: Прогнать, вручную (импортировать тестовый CSV на dev-данных
  — можно синтетический с 2-3 строками), commit**

```bash
git add web/src
git commit -m "feat(web): раздел «Справочник сотрудников» — CRUD и импорт из 1С"
```

---

### Task 4: Раздел «Грейдирование — настройка»

**Files:** Create: `web/src/features/admin/grading/*` + тесты, `useGradingAdmin.ts`, css
Modify: `web/src/api/grading.ts` (добавить admin-методы), `contract.ts`
(`GradingBlockAssignment`, `CommitteeMember`, `PendingCommitteeJob`)

**Interfaces:** `gradingApi.saveFactor(...)`, `.resetFactor(...)`,
`.adminBlocks()`, `.adminBlockPositions(block)`, `.reassignBlockPosition(...)`,
`.resetEvaluation(...)`, `.committee(block)`, `.addCommitteeMember(...)`,
`.removeCommitteeMember(...)`, `.pendingCommittee()`, `.finalizeCommittee(...)`

- [x] **Step 1: Тесты**

Три вкладки (формулировки/блоки/комиссия) переключаются независимо.
«Сбросить утверждённую оценку» и «Подвести итог принудительно» требуют
подтверждения (необратимые действия).

- [x] **Step 2: Вкладка «Формулировки»**
- [x] **Step 3: Вкладка «Блоки»** — перенос должности между блоками,
  сброс оценки
- [x] **Step 4: Вкладка «Комиссия»** — состав по блоку, добавить/убрать по
  ФИО, список в ожидании кворума
- [x] **Step 5: Прогнать, вручную (перенести тестовую должность между
  блоками на dev-данных, добавить себя в комиссию блока), commit**

```bash
git add web/src
git commit -m "feat(web): раздел «Грейдирование — настройка» — формулировки, блоки, комиссия"
```

---

### Task 5: Раздел «Бенчмаркинг — импорт и сопоставление»

**Files:** Create: `web/src/features/admin/benchmark/*` + тесты, `useBenchmarkAdmin.ts`, css
Modify: `web/src/api/benchmark.ts` (admin-методы), `contract.ts`
(`BenchmarkSource`, `BenchmarkDataset`, `PositionMapping`, `ImportDryRunReport`)

**Interfaces:** `benchmarkApi.sources()`, `.createSource(...)`,
`.updateSource(...)`, `.sourceWeights(...)`, `.positionWeights(...)`,
`.datasets(...)`, `.deleteDataset(id)`, `.sourcePositions(sourceKey)`,
`.mappings(sourceKey)`, `.suggestMappings(sourceKey)`, `.saveMapping(...)`,
`.deleteMapping(id)`, `.fx(currency)`, `.xlsxSheets(fileBase64)`,
`.xlsxGrid(fileBase64, sheet)`, `.importDryRun(...)`, `.importCommit(...)`

- [x] **Step 1: Тесты мастера импорта**

Шаги мастера (файл → лист → сетка/колонки → dry-run отчёт → commit) не
пропускают этап: `commit` невозможен без предварительного успешного
`dry-run` в том же сеансе формы (стейт шага в компоненте, не отдельный
роут на шаг).

- [x] **Step 2: Вкладка «Источники»** — список, создать/редактировать, веса
- [x] **Step 3: `BenchmarkImportWizard`** — четыре шага
- [x] **Step 4: Вкладка «Сопоставление»** — таблица + автоподсказки
- [x] **Step 5: Вкладка «Наборы данных»** — список, удаление
- [x] **Step 6: Прогнать, вручную (импорт тестового xlsx на dev-данных,
  если под рукой есть образец файла — иначе как минимум dry-run с ручным
  вводом текста), commit**

```bash
git add web/src
git commit -m "feat(web): раздел «Бенчмаркинг» — импорт, источники, сопоставление позиций"
```

---

### Task 6: Раздел «Периоды сбора»

**Files:**
- Create: `web/src/api/periods.ts`, `web/src/features/admin/periods/*` + тесты, `usePeriods.ts`, css
- Modify: `contract.ts` (`PeriodRow`, `PeriodGrantRow`, `PeriodGrantsResponse`)

**Уточнение (см. спеку, раздел 3):** отдельного серверного маршрута не
нужно — `GET /admin/period-grants` уже отдаёт оба списка: `grants` и
**все** периоды (`periods`, не только активный). Сервер не меняется
вовсе в этой задаче.

**Interfaces:** `periodsApi.list()` (читает `/admin/period-grants`,
отдаёт `{grants, periods}`), `.setPeriod(action, payload)`,
`.grant(...)`, `.revokeGrant(...)`, `.grantUsers()`, `.deletePeriod(id)`

- [x] **Step 1: Тесты клиента**

«Новый период» показывает предупреждение о сбросе `actual` — текст
дословно из старого клиента (`client/app.js:14357`: «Начнётся новый год
сбора с чистого листа. Данные закрытого периода останутся в архиве.»);
удаление непустого периода показывает ошибку сервера как есть; активация
архивного периода показывает предупреждение из `client/app.js:11786`
(«...Прежний активный период станет архивным...»).

- [x] **Step 2: Реализация экрана + панель грантов на архивный период**
- [x] **Step 3: Прогнать, вручную (посмотреть список периодов на dev-данных,
  выдать/отозвать грант тестовому пользователю — не создавать новый
  реальный период без необходимости, это разрушительно для dev-данных;
  если нужно проверить `new`/`close`, делать на отдельной ветке dev.db,
  не на общей), commit**

```bash
git add web/src
git commit -m "feat(web): раздел «Периоды сбора»"
```

---

### Task 7: Финальная проверка этапа

- [x] **Step 1:** `npm test`, `npm --prefix web test`, `npm --prefix web run build`
- [x] **Step 2:** Сквозная проверка прав — под ролью без единого
  административного права пункт «Администрирование» не виден и `/admin/*`
  не открывается по прямой ссылке (редирект/403, как у прочих разделов);
  под `role==='admin'` видны все семь карточек хаба.
- [x] **Step 3:** Телефон 375px — хотя бы один из тяжёлых экранов
  (`BenchmarkImportWizard` или таблица пользователей) не ломает раскладку.
- [x] **Step 4:** Обновить `farovon-react-redesign-branch.md` (память) —
  статус этапа 6.
- [x] **Step 5:** Commit

```bash
git commit -m "docs: этап 6 (администрирование) — план выполнен целиком" --allow-empty
```
