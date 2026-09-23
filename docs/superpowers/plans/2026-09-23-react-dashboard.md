# План реализации: новый клиент на React, этап 3 (дашборды)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Раздел `/dashboard` в новом клиенте с шестью вкладками (Обзор, Зарплатные
вилки, По регионам, Льготы и бонусы, Бенчмаркинг, Прогресс), новыми разрезами
аналитики (надёжность, источник, график, грейд, валюта, прочие выплаты в
совокупном доходе) и одним консолидированным эндпоинтом вместо двух.

**Architecture:** Без изменений относительно этапов 0–2: `web/` собирается в
`client/next/`, Express отдаёт на `/new`. Новые разрезы — функции в
`src/services/analyticsService.js` рядом с существующими (`regionStats` и
т.п.), без переписывания `getExtendedAnalytics`. Общие визуальные примитивы
(`KpiTile`, `ForkBar`, `RankBar`) — в `web/src/design/`, переиспользуются
всеми вкладками.

**Tech Stack:** тот же, что в этапах 0–2 (см. `2026-09-22-react-stage0-1.md`).

**Spec:** `docs/superpowers/specs/2026-09-23-react-dashboard-design.md`.

## Global Constraints

Те же, что в плане этапов 0–1 (Node 26, файл > 400 строк — разбить, разметка
только JSX, без веб-шрифтов, телефон 375 px — основной сценарий, тексты по-русски).
Дополнительно:

- Существующие ответы `/api/dashboard/extended` и `/api/dashboard/hrbp` не
  ломаются — их поля только добавляются, старый клиент их ещё использует
  до этапа 9.
- Новый расчёт (совокупный доход, конвертация валют) должен давать те же числа,
  что сегодня, там, где условия не изменились (нет премии → было 0 и раньше по
  сути, просто не показывалось; сомони без конвертации — как есть).

## Карта файлов

**Сервер (изменяется):**
- `src/services/analyticsService.js` — `trustStats`, `sourceStats`,
  `scheduleStats`, `gradeStats`, правка совокупного дохода и общей медианы
  (валюта)
- `src/services/fxService.js` — курс на дату (если ещё не умеет)
- `src/controllers/dashboardController.js` — `getDashboard` (общий)
- `src/routes/api.js` — `POST /api/dashboard`
- `test/analyticsService.test.js` (или отдельный файл на разрезы), `test/dashboardRoute.test.js`

**Клиент (новое, `web/`):**
- `web/src/api/dashboard.ts`, дополнения в `web/src/api/contract.ts`
- `web/src/design/KpiTile.tsx` + css, `web/src/design/ForkBar.tsx` + css, `web/src/design/RankBar.tsx` + css
- `web/src/features/dashboard/DashboardScreen.tsx`, `DashboardFilters.tsx`, `useDashboard.ts`
- `web/src/features/dashboard/OverviewTab.tsx`, `SalariesTab.tsx`, `RegionsTab.tsx`, `BenefitsTab.tsx`, `BenchmarkTab.tsx`, `ProgressTab.tsx`
- `web/src/app/routes.tsx`, `web/src/features/shell/NavItems.ts` — маршрут и пункт меню

---

### Task 1: Разрезы аналитики на сервере

**Files:**
- Modify: `src/services/analyticsService.js`
- Create/modify: тест на разрезы (в существующем файле аналитики или новом `test/analyticsDashboard.test.js`)

**Interfaces:**
- Produces: `trustStats`, `sourceStats`, `scheduleStats`, `gradeStats` — массивы
  `{ key: string; count: number; min; p25; median; p75; max; avg: number }`,
  та же форма, что у `regionStats`.
- Правка: `bonusMonthly` в общем совокупном доходе (не только в реестре) и
  исключение строк без курса валюты из общей медианы (`summary.salaryMedian`).

- [ ] **Step 1: Тесты на новые разрезы — пишутся первыми, до реализации**

Фикстуры — 3–4 синтетических `surveys` с разным `trust`/`source`/`schedule`/`grade`,
как в существующих тестах `regionStats`. Проверить: группировка верна, пустые
значения не создают группу «пусто», вилка считается тем же `calculateSalaryForkStats`,
что и везде (не отдельной копией формулы).

- [ ] **Step 2: Прогнать — падает** (функций ещё нет)

- [ ] **Step 3: Реализация**

Каждый разрез — как `regionStats`: собрать `Map<key, {froms,tos,mids}>` в
основном цикле по `surveys` (рядом с уже существующим сбором `regionSamples`),
затем в конце — `Object.keys(...).map(k => ({ key: k, ...calculateSalaryForkStats(...) }))`.
Добавить четыре новых поля в объект возврата `getExtendedAnalytics`.

Совокупный доход: перенести правило из `src/services/registryService.js`
(`bonusMonthly = bonHas === 'нет' ? 0 : varPay.monthly`) в место, где
`getExtendedAnalytics` считает `totalSamples` для `positionsList[].totalMedian`
— сегодня там `bm = (c.varPay && c.varPay.monthly != null) ? c.varPay.monthly : 0`,
не различает явное «нет» от «неизвестно».

Конвертация валют: `fxService` даёт курс по валюте и (если уже поддерживает)
дате; строка без курса — не участвует в `allSalarySamples`/`regionSamples`
и т.д., но остаётся в `rawRows` (реестр её не теряет, только не путает
статистику). Пометить `fxMissing: true` в `rawRows`, чтобы дашборд мог
показать предупреждение вместо тихого исключения.

- [ ] **Step 4: Прогнать все серверные тесты**

`npm test` — новые тесты зелёные, существующие не сломаны (особенно
`registryService.test.js`, если правило про «нет премии» вынесено в общее
место, а не продублировано).

- [ ] **Step 5: Commit**

```bash
git add src/services/analyticsService.js test/
git commit -m "feat(аналитика): разрезы по надёжности, источнику, графику, грейду; совокупный доход и валюта в общей медиане"
```

---

### Task 2: Маршрут `/api/dashboard`

**Уточнение при реализации:** `getHRBPDashboard` — отдельный экран
координации (этап 4), не альтернатива `getExtendedAnalytics`; трогаем
только `getCBDashboard` (см. правку спеки, раздел 3.1).

**Files:**
- Modify: `src/controllers/dashboardController.js`, `src/routes/api.js`
- Create/modify: тест маршрута (по образцу существующих для реестра)

**Interfaces:**
- Produces: `POST /api/dashboard` — `requireCapability('dashboard:view')`, тело
  `{ period?, dir?, hrbp?, region? }`, ответ — форма `getExtendedAnalytics`.

- [ ] **Step 1: Реализация**

`dashboardController.getDashboard` — то же тело, что у `getCBDashboard`
(вызов `getExtendedAnalytics(filters, { unitFilter })` с тем же
`scoped`-флагом); `getCBDashboard`/`/dashboard/extended` остаются как есть
для старого клиента, `getHRBPDashboard`/`/dashboard/hrbp` не трогаются.

- [ ] **Step 2: Тест доступа**

403 без `dashboard:view`; форма ответа содержит новые поля из Task 1.

- [ ] **Step 3: Прогнать и commit**

```bash
git add src/controllers/dashboardController.js src/routes/api.js test/
git commit -m "feat(сервер): единый POST /api/dashboard для нового клиента"
```

---

### Task 3: Слой API клиента и общие визуальные примитивы

**Files:**
- Create: `web/src/api/dashboard.ts`, `web/src/design/KpiTile.tsx` + `.module.css`, `web/src/design/ForkBar.tsx` + `.module.css`, `web/src/design/RankBar.tsx` + `.module.css`, тесты на `ForkBar` (проценты по вырожденным случаям)
- Modify: `web/src/api/contract.ts` — типы `DashboardResponse`, `ForkStats`, `PositionStat` и т.д. (расширение существующего, если типы уже частично описаны для реестра/аналитики)

**Interfaces:**
- Produces:
  - `dashboardApi.get(filters: DashboardFilters): Promise<DashboardResponse>`
  - `KpiTile({ label, value, hint? })`
  - `ForkBar({ label, stats: ForkStats, rightValue? })` — рисует шкалу по
    `min/p25/median/p75/max`; вырожденный случай `min === max` — сплошная точка,
    не деление на ноль в проценте ширины.
  - `RankBar({ label, pct, count? })`

- [ ] **Step 1: Тест `ForkBar` — процентные позиции блока и риски**

Тестировать чистую функцию расчёта процентов (`forkLayout(stats): {barLeft, barWidth, medianLeft, lineLeft, lineWidth}` в `web/src/domain/` — не завязывать на DOM), затем сам компонент рендерит по её результату.

- [ ] **Step 2: Реализация** (KpiTile/ForkBar/RankBar + `forkLayout`)

- [ ] **Step 3: Слой API**

`dashboard.ts` — тонкая обёртка над `client.ts` (как `registry.ts`), без своей
логики фильтров (те же query-параметры, что и `useRegistry`).

- [ ] **Step 4: Прогнать и commit**

```bash
git add web/src/api web/src/design
git commit -m "feat(web): слой запросов дашборда, плитка KPI, шкала вилки, полоса рейтинга"
```

---

### Task 4: Экран, навигация по вкладкам, общие фильтры

**Files:**
- Create: `web/src/features/dashboard/DashboardScreen.tsx` + css, `DashboardFilters.tsx`, `useDashboard.ts`
- Modify: `web/src/app/routes.tsx`, `web/src/features/shell/NavItems.ts` (+ тест)

**Interfaces:**
- Produces: маршрут `/dashboard/:tab?`; `useDashboard()` → `{ data, isLoading, error, filters, patch, tab, setTab }`, фильтры и вкладка в query-параметрах (как `useRegistry`).

- [ ] **Step 1: Тест навигации** — пункт меню виден только при `dashboard:view`,
скрыт без него (расширение существующего `NavItems.test.ts`).

- [ ] **Step 2: `useDashboard` и `DashboardScreen`**

Вкладки — таббар вверху раздела (переиспользовать `TopBar`/паттерн вкладок,
если уже есть общий компонент, иначе — простой `<nav>` со ссылками на
`/dashboard/overview` и т.д., активная подсвечена). `DashboardFilters` — одна
панель над вкладками, значения — в тех же query-параметрах.

- [ ] **Step 3: Заглушки вкладок**

Каждая вкладка — `<h2>…</h2>` в своём файле, заменяются в следующих задачах.

- [ ] **Step 4: Прогнать вручную и commit**

`/new/dashboard` открывается, вкладки переключаются, пункт меню скрыт для роли
без `dashboard:view`.

```bash
git add web/src
git commit -m "feat(web): раздел дашбордов — вкладки, общие фильтры, маршрут"
```

---

### Task 5: Вкладка «Обзор»

**Files:** Create: `web/src/features/dashboard/OverviewTab.tsx` + тест

- [ ] **Step 1: Тест** — рендерит KPI-плитки из моков `dashboardApi`, топ-6
должностей строками, карточку рейтинга льгот.
- [ ] **Step 2: Реализация** (по мокапу `04-dashboard.html`, раздел 4.3 спеки)
- [ ] **Step 3: Прогнать, вручную сверить числа с текущим дашбордом старого клиента, commit**

---

### Task 6: Вкладка «Зарплатные вилки»

**Files:** Create: `web/src/features/dashboard/SalariesTab.tsx`, шторка по клику на должность (переиспользовать вёрстку ячеек компании из `RecordSheet.tsx`), тесты

- [ ] **Step 1: Тест** — поиск по названию должности фильтрует список; клик
открывает шторку с компаниями.
- [ ] **Step 2: Реализация**
- [ ] **Step 3: Прогнать, вручную, commit**

---

### Task 7: Вкладки «По регионам» и «Льготы и бонусы»

**Files:** Create: `web/src/features/dashboard/RegionsTab.tsx`, `BenefitsTab.tsx`, тесты

- [ ] **Step 1: Тесты** — таблица регионов отсортирована по медиане; рейтинг
льгот и премий рендерится из `topBenefits`/`bonuses`.
- [ ] **Step 2: Реализация**
- [ ] **Step 3: Прогнать, вручную, commit**

---

### Task 8: Вкладка «Бенчмаркинг» (только чтение)

**Files:** Create: `web/src/features/dashboard/BenchmarkTab.tsx`, `web/src/api/benchmark.ts`, тесты

**Interfaces:** Consumes: `GET /benchmarks/compare`, `GET /benchmarks/summary-widgets` (`benchmarks:view`).

- [ ] **Step 1: Тест** — вкладка не отображается в списке вкладок без
`benchmarks:view`; с правом — выбор должности запускает `compare`, таблица
источников рендерится по образцу `05-benchmark.html`.
- [ ] **Step 2: Реализация**
- [ ] **Step 3: Прогнать, вручную, commit**

---

### Task 9: Вкладка «Прогресс»

**Files:** Create: `web/src/features/dashboard/ProgressTab.tsx`, тест

- [ ] **Step 1: Тест** — две таблицы (`hrbpProgress`, `dirProgress`) с полосой
прогресса, сортировка по проценту.
- [ ] **Step 2: Реализация**
- [ ] **Step 3: Прогнать, вручную, commit**

---

### Task 10: Финальная проверка этапа

**Files:** Modify: `docs/redesign-inventory.md` (если ведёт учёт по этапам)

- [ ] **Step 1: Прогнать всё** — `npm test` (сервер), `npm --prefix web test`,
`npm --prefix web run build`
- [ ] **Step 2: Сквозная проверка (раздел 15 ТЗ, применимо к этому этапу)** —
цифры на «Обзоре» совпадают с текущим дашбордом старого клиента на тех же
данных и фильтрах; под каждой из ролей видно то же, что и должно (HR BP не
видит чужие подразделения на дашборде, как и в реестре); отключение JS-консоли
без ошибок на всех шести вкладках, включая телефон 375 px
- [ ] **Step 3: Обновить опись** (если есть общий список пройденных этапов)
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: этап 3 (дашборды) — отметка о завершении"
```
