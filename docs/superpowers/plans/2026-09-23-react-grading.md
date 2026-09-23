# План реализации: новый клиент на React, этап 5 (оценка должностей и риски)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/grading/:block?` — карточки блоков, список должностей, анкета
из семи факторов с эталонной должностью, слепая комиссия; `/key-risks` —
тепловая карта, список «Требуют внимания», анкета риска по сотруднику.

**Architecture:** Сервер не меняется — 20 маршрутов `gradingController.js`
уже готовы, математика в `gradingService.js` уже покрыта тестами. Этап
целиком клиентский, по образцу `features/dashboard/`/`features/coordination/`.

**Tech Stack:** тот же, что в этапах 0–4.

**Spec:** `docs/superpowers/specs/2026-09-23-react-grading-design.md`.

## Global Constraints

Общие для всех этапов. Дополнительно:
- Сервер не трогаем вовсе — ни одного файла в `src/`.
- Административные права (`grading:factors`/`grading:blocks`/
  `grading:committee`) не получают экранов в этом этапе — переезжают в
  этап 6.

## Карта файлов (клиент)

- `web/src/api/grading.ts`, `web/src/api/keyRisks.ts`, дополнения в `web/src/api/contract.ts`
- `web/src/design/ScaleInput.tsx` + css
- `web/src/features/grading/GradingScreen.tsx`, `BlocksList.tsx`, `PositionsList.tsx`, `PositionForm.tsx`, `useGrading.ts` + css
- `web/src/features/keyRisks/KeyRisksScreen.tsx`, `RiskHeatmap.tsx`, `RiskList.tsx`, `RiskForm.tsx`, `useKeyRisks.ts` + css
- `web/src/app/routes.tsx`, `web/src/features/shell/NavItems.ts`

---

### Task 1: Слой API и общий примитив `ScaleInput`

**Files:**
- Create: `web/src/api/grading.ts`, `web/src/api/keyRisks.ts`, `web/src/design/ScaleInput.tsx` + `.module.css` + тест
- Modify: `web/src/api/contract.ts` — `GradingFactor` (`code, title, help, options[5], examples[5]`), `GradingBlock`, `GradingPosition`, `EvaluateResponse` (union по `pending`/`finalized`), `RiskFactor`, `RiskLevel`, `KeyRisk`, `HeatmapRow`

**Interfaces:**
- Produces:
  - `gradingApi.factors(dir?)`, `.blocks()`, `.positions(block)`, `.evaluate({block, jobTitle, factors, notes})`, `.stats()`
  - `keyRisksApi.list({unit?, status?})`, `.unitEmployees(unit)`, `.evaluate({unit, employeeFio, jobTitle, ...answers, actionPlan?})`, `.heatmap()`, `.delete(id)`
  - `ScaleInput({ value, onChange, options, examples? })` — пять кнопок 1–5,
    под активной — `examples[value-1]`, если передан.

- [ ] **Step 1: Тест `ScaleInput`**

Клик по варианту вызывает `onChange` с номером (1–5); эталон показывается
только под выбранным, не под всеми сразу.

- [ ] **Step 2: Реализация `ScaleInput` + слой API**
- [ ] **Step 3: Прогнать, commit**

```bash
git add web/src/api web/src/design
git commit -m "feat(web): слой запросов грейдирования и рисков, шкала 1–5 с эталоном"
```

---

### Task 2: Экран «Оценка должностей» — блоки

**Files:** Create: `web/src/features/grading/GradingScreen.tsx`, `BlocksList.tsx` + тесты, `useGrading.ts`, css
Modify: `web/src/app/routes.tsx`, `web/src/features/shell/NavItems.ts` (+ тест, право `grading:view`+`grading:edit`)

- [ ] **Step 1: Тест навигации и карточек блоков**

Пункт меню виден при `grading:view` или `grading:edit`. Карточка блока
показывает `N из M`, клик ведёт на `/grading/<key>`.

- [ ] **Step 2: Реализация**

`useGrading()` — блок из `useParams`, запрос `blocks()` всегда, `positions(block)`
только когда блок выбран (`enabled`).

- [ ] **Step 3: Прогнать, вручную, commit**

```bash
git add web/src
git commit -m "feat(web): раздел «Оценка должностей» — карточки блоков"
```

---

### Task 3: Список должностей блока и анкета

**Files:** Create: `PositionsList.tsx`, `PositionForm.tsx` + тесты

**Interfaces:** Consumes: `getPositions` ответ (`isCommitteeMember`,
`committeeSize`, `my_submission`, `units[]` на подсказку).

- [ ] **Step 1: Тесты**

- Статус строки: `не начата` (нет `evaluation_id` и `submitted_count===0`),
  `идёт оценка N из M` (комиссия, `0 < submitted_count < committeeSize`),
  `оценена` (есть `grade_level`)
- Утверждённая должность в блоке с комиссией — форма не даёт отправить
  повторно (кнопка скрыта/задизейблена, не ждём 409 от сервера)
- Три ветки ответа `evaluate` — три разных текста тоста
  (`pending`/`finalized`/обычный)

- [ ] **Step 2: Реализация**

`PositionForm` — семь `ScaleInput`, `notes` — `Textarea`, кнопка
«Отправить оценку» вызывает `gradingApi.evaluate`. Подсказка «список
подразделений» — `title`/поповер у числа в таблице.

- [ ] **Step 3: Сводка по грейдам**

Кнопка/блок на экране блоков — `gradingApi.stats()`, таблица блок × грейд,
без отдельного маршрута.

- [ ] **Step 4: Прогнать, вручную (пройти анкету целиком на dev-данных), commit**

```bash
git add web/src
git commit -m "feat(web): список должностей блока, анкета из семи факторов, сводка по грейдам"
```

---

### Task 4: Экран «Риски ключевого персонала»

**Files:** Create: `web/src/features/keyRisks/KeyRisksScreen.tsx`, `RiskHeatmap.tsx`, `RiskList.tsx`, `RiskForm.tsx` + тесты, `useKeyRisks.ts`, css
Modify: `web/src/app/routes.tsx`, `web/src/features/shell/NavItems.ts` (+ тест, право `keyrisk:view`+`keyrisk:edit`)

- [ ] **Step 1: Тесты**

- Тепловая карта красит ячейку по уровню (класс/цвет меняется от `n`)
- Список «Требуют внимания» = `attention` + `critical`, отсортирован по
  баллу
- Кнопка «Удалить» видна только `role === 'admin'`
- Анкета: выбор подразделения подгружает `unit-employees`, отправка
  зовёт `evaluate` с верными полями

- [ ] **Step 2: Реализация**

`RiskForm` — `Select` подразделения (свои, если не admin/cb — список из
сессии, как в `SheetScreen`), `Select` сотрудника из `unitEmployees`, четыре
`Select` вопроса риска (`RISK_FACTORS`), `Textarea` плана действий
(необязательно — сервер подставит рекомендацию сам).

- [ ] **Step 3: Прогнать, вручную (телефон 375px — сетка тепловой карты в
  столбец), commit**

```bash
git add web/src
git commit -m "feat(web): раздел «Риски ключевого персонала» — тепловая карта, список, анкета"
```

---

### Task 5: Финальная проверка этапа

- [ ] **Step 1:** `npm --prefix web test`, `npm --prefix web run build`
      (сервер не менялся — `npm test` дополнительно не обязателен, но не
      повредит прогнать для очистки совести)
- [ ] **Step 2:** Сквозная проверка — под ролью без `grading:*`/`keyrisk:*`
  пункты меню не видны и по прямой ссылке не открываются; заполнение
  анкеты должности целиком на dev-данных даёт балл и грейд, совпадающие с
  тем, что показывал бы старый клиент на тех же цифрах; анкета риска —
  то же для суммы 4–20 и трёх статусов
- [ ] **Step 3:** Commit

```bash
git commit -m "docs: этап 5 (оценка должностей и риски) — план выполнен целиком" --allow-empty
```
