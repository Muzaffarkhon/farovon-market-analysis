# План реализации: новый клиент на React, этап 4 (координация для HR BP)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Раздел `/coordination` — прогресс по направлениям и по людям,
лента последних записей, точечное напоминание в Telegram выбранным людям.

**Architecture:** Новый `src/services/coordinationService.js` — bulk-запросы
(без цикла с запросом на подразделение), не трогает `dashboardController.
getHRBPDashboard` (старый клиент). Новая capability `coordination:view`.
Клиент — по образцу `features/dashboard/`: один экран, один запрос,
TanStack Query.

**Tech Stack:** тот же, что в этапах 0–3.

**Spec:** `docs/superpowers/specs/2026-09-23-react-coordination-design.md`.

## Global Constraints

Общие для всех этапов (Node 26, файл > 400 строк — разбить, разметка JSX,
телефон 375 px, тексты по-русски). Дополнительно:

- `services/telegramService.sendMassReminder` не трогаем — её починка
  относится к этапу 7.
- Bulk-агрегация: ни одного запроса внутри цикла по подразделениям/людям.

## Карта файлов

**Сервер:**
- `src/config/capabilities.js` — `coordination:view`, дефолты `hrbp`/`dir_head`
- `src/services/coordinationService.js` (новый)
- `src/services/telegramService.js` — `sendCoordinationReminder` (новая, отдельная от `sendMassReminder`)
- `src/controllers/coordinationController.js` (новый)
- `src/routes/api.js` — `GET /api/coordination`, `POST /api/coordination/remind`
- `test/coordinationService.test.js` (новый)

**Клиент:**
- `web/src/api/coordination.ts`, дополнения в `web/src/api/contract.ts`
- `web/src/features/coordination/CoordinationScreen.tsx` + css, `useCoordination.ts`
- `web/src/features/coordination/UnitsProgress.tsx`, `PeopleProgress.tsx`, `ActivityFeed.tsx`
- `web/src/app/routes.tsx`, `web/src/features/shell/NavItems.ts`

---

### Task 1: Capability `coordination:view`

**Files:** Modify: `src/config/capabilities.js`

- [x] **Step 1: Добавить и включить по умолчанию**

`CAPABILITIES` — новая запись `{ id: 'coordination:view', resource:
'coordination', resourceLabel: 'Координация', label: 'Просмотр' }`.
`DEFAULT_ROLE_CAPABILITIES.hrbp` и `.dir_head` — добавить
`'coordination:view'` в массив.

- [x] **Step 2: Прогнать существующие тесты конструктора ролей**

Если есть тесты на полный список capabilities/дефолтов — обновить ожидания.

- [x] **Step 3: Commit**

```bash
git add src/config/capabilities.js
git commit -m "feat(права): coordination:view для HR BP и руководителя направления"
```

---

### Task 2: `coordinationService` — прогресс по подразделениям и людям

**Files:**
- Create: `src/services/coordinationService.js`, `test/coordinationService.test.js`

**Interfaces:**
- Produces: `async getCoordination({ periodId, unitFilter }) → { units, people, feed }`
  (форма в спеке, раздел 3.2).

- [x] **Step 1: Тесты — пишутся первыми**

Синтетические `divisions`/`unit_positions`/`surveys`/`position_no_comparison`/
`users` (как фикстуры `registryService.test.js`, без реальной базы —
функция принимает уже прочитанные строки, чистая). Проверить:
- подразделение без штатки → `positionsTotal: 0`, не считается «полностью»
- человек и `resp`, и в `users.units` того же юнита — не задвоен
- `people` не включает неактивных пользователей
- `feed` отсортирована по `created_at desc`, обрезана до 30
- `unitFilter` сокращает и `units`, и `people`, и `feed`

- [x] **Step 2: Прогнать — падает**

- [x] **Step 3: Реализация**

Три bulk-запроса (как в `getHRBPDashboard`): `unit_positions` → Map
unit→Set(positions); `surveys` (текущий период, `state != 'удалена'`) →
Map unit→{decided-ключи по `pos_our` с содержательными данными,
как `surveyHasSubstance`}; `position_no_comparison` → Map unit→Set. Свести
в `positionsDecided`/`positionsTotal` на юнит — та же математика, что
`positionProgress` в `analyticsService.js` (переиспользовать функцию,
не копировать).

Люди: `users.units` (split `;`) плюс `divisions.resp`/`.head` — свести к
`Map<login, Set<unit>>`, затем просуммировать `positionsTotal`/
`positionsDecided` по юнитам каждого человека (без повторного счёта одного
юнита дважды).

Лента: `surveys` той же выборки, сортировка по `created_at`, срез 30.

- [x] **Step 4: Прогнать тесты, commit**

```bash
git add src/services/coordinationService.js test/
git commit -m "feat(координация): сервис прогресса по подразделениям и людям"
```

---

### Task 3: Маршруты и точечное напоминание

**Files:**
- Create: `src/controllers/coordinationController.js`
- Modify: `src/routes/api.js`, `src/services/telegramService.js`
- Create/modify: тест на `sendCoordinationReminder` и на доступ маршрута

**Interfaces:**
- Produces: `GET /api/coordination`, `POST /api/coordination/remind { logins: string[] } → { ok, sent, skipped }`
- Produces: `telegramService.sendCoordinationReminder(logins, coordination) → { sent, skipped }`

- [x] **Step 1: Тест `sendCoordinationReminder`**

Мокнуть `sendTelegramMessage` (или проверить через возвращаемые счётчики
без реальной отправки, как уже сделано для похожих функций, если есть
образец в `test/`). Человек без `telegram_chat_id` → skipped, не sent;
человек с закрытым охватом (`positionsDecided === positionsTotal`) →
пропущен без отправки, а не «отправлено 0 незакрытых».

- [x] **Step 2: Реализация**

`sendCoordinationReminder` — рядом с `sendMassReminder`, использует
`coordinationService.getCoordination` для расчёта личного охвата каждого
из `logins`, текст сообщения — список **его** незакрытых подразделений
(не всего холдинга).

`coordinationController.getCoordination` — `requireCapability('coordination:view')`,
зовёт сервис с `unitScopeFilter(req.user)`.
`coordinationController.remind` — та же проверка, вызывает
`sendCoordinationReminder`.

- [x] **Step 3: Маршруты**

```js
router.get('/coordination', requireCapability('coordination:view'), coordinationController.getCoordination);
router.post('/coordination/remind', requireCapability('coordination:view'), coordinationController.remind);
```

- [x] **Step 4: Прогнать все серверные тесты, ручная проверка через curl, commit**

```bash
git add src/controllers/coordinationController.js src/routes/api.js src/services/telegramService.js test/
git commit -m "feat(сервер): маршруты координации и точечное напоминание в Telegram"
```

---

### Task 4: Клиент — экран координации

**Files:**
- Create: `web/src/api/coordination.ts`, `web/src/features/coordination/CoordinationScreen.tsx` + css, `useCoordination.ts`, `UnitsProgress.tsx`, `PeopleProgress.tsx`, `ActivityFeed.tsx` + тесты на каждый
- Modify: `web/src/api/contract.ts`, `web/src/app/routes.tsx`, `web/src/features/shell/NavItems.ts` (+ тест)

**Interfaces:**
- Produces: маршрут `/coordination`; `coordinationApi.get()`, `coordinationApi.remind(logins)`.

- [x] **Step 1: Тест навигации** — пункт меню виден только при `coordination:view`.

- [x] **Step 2: Типы и слой API**

`CoordinationResponse` в `contract.ts` (форма из спеки 3.2).

- [x] **Step 3: `UnitsProgress`**

Список подразделений с `RankBar`/полосой прогресса, сортировка «сначала
отстающие» — тест: подразделение 0 из 5 выше, чем 4 из 5.

- [x] **Step 4: `PeopleProgress`**

Список людей с чекбоксами выбора, дата последнего входа, охват. Тест:
выбор людей копится в состоянии; человек без Telegram помечен, но
выбираем.

- [x] **Step 5: `ActivityFeed`**

Простой список последних 30 записей.

- [x] **Step 6: `CoordinationScreen` и кнопка «Напомнить»**

Собирает три блока; кнопка вызывает `coordinationApi.remind(selectedLogins)`,
тост с `sent`/`skipped` из ответа. Тест: клик отправляет ровно выбранные
логины, тост показывает числа из ответа сервера.

- [x] **Step 7: Прогнать всё, вручную (телефон 375px), commit**

```bash
git add web/src
git commit -m "feat(web): экран «Координация» — прогресс по направлениям и людям, напоминание"
```

---

### Task 5: Финальная проверка этапа

- [x] **Step 1:** `npm test`, `npm --prefix web test`, `npm --prefix web run build`
- [x] **Step 2:** Сквозная проверка — под hrbp и dir_head экран виден и показывает
  только свои направления; под head и user — не виден ни в меню, ни по
  прямой ссылке (редирект/403); напоминание реально уходит выбранным (проверить
  на dev-пользователе с `telegram_chat_id`, если он есть в сидах, иначе —
  через мок/логи)
- [x] **Step 3:** Commit

```bash
git commit -m "docs: этап 4 (координация) — план выполнен целиком" --allow-empty
```
