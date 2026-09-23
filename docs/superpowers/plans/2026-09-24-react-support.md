# План реализации: этап 8 (чат поддержки)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Уведомления администраторам на новое сообщение в любом канале
(не только на открытие/переоткрытие), throttled раз в 5 минут на тред —
закрывает главную дыру (web-треды не уведомляли вовсе). `/support` —
экран сотрудника в новом клиенте (сейчас нет вовсе). `/admin/support` —
инбокс в новом клиенте (сейчас только в старом): список, фильтры, детали,
готовые фразы, FAQ, привязка к сотруднику.

**Architecture:** Сервер — минимально: одна новая колонка, централизация
уведомлений в `supportChatService.js`, никаких новых маршрутов (всё уже
есть в `supportController.js`/`myServiceController.js`). Клиент — два
новых раздела по образцу `features/admin/*` (список+детали, Sheet для
форм) и `features/dashboard` (поллинг).

**Tech Stack:** тот же, что в этапах 0–7.

**Spec:** `docs/superpowers/specs/2026-09-24-react-support-design.md`.

## Global Constraints

- Не меняем схему `support_threads`/`support_messages` кроме добавления
  `notified_at` — остальное уже покрывает нужные поля.
- Не трогаем `linkEmployee`/`resetAndSendCredentials` — логика привязки и
  выдачи пароля уже корректна, только вызываем с клиента.
- `support:manage` — уже существующая capability, новых прав не заводим.
- `/support` — без капабилити-гейта, как у `myServiceController` на
  сервере (любой залогиненный).

## Карта файлов

- `src/db/migrate.js` — `support_threads.notified_at`
- `src/services/supportChatService.js` — `maybeNotifySupportTeam`, вызовы
  из `saveIncomingMessage`/`createWebThread`/`saveOwnMessage`
- `src/controllers/telegramController.js` — убрать 2 точечных вызова
  `notifySupportTeam`, оставить один явный в `openSupportThreadForGuest`
- `web/src/api/support.ts` (новый), `web/src/api/contract.ts` (типы)
- `web/src/features/support/{SupportScreen,ThreadView,FaqList}.tsx` +
  `useMySupport.ts` + css (сотрудник)
- `web/src/features/admin/support/{SupportInboxScreen,ThreadList,ThreadDetail,
  LinkEmployeePanel,SupportSettingsSheet}.tsx` + `useSupportInbox.ts` + css
  (админ)
- `web/src/app/routes.tsx`, `web/src/features/shell/NavItems.ts`,
  `web/src/features/admin/AdminHub.tsx`

---

### Task 1: Централизация уведомлений

**Files:** Modify: `src/db/migrate.js`, `supportChatService.js`,
`telegramController.js`

- [x] **Step 1: Тесты**

Throttle-логика (чистая функция `shouldNotify(notifiedAt, now)`,
вынесенная отдельно от похода в БД): `null`/просроченный `notified_at`
(>5 мин) → true; свежий (<5 мин) → false.

- [x] **Step 2: Реализация**

Колонка `notified_at`. `maybeNotifySupportTeam(threadId)` в
`supportChatService.js` (см. спеку §3.1) — вызовы из
`saveIncomingMessage`, `createWebThread`, `saveOwnMessage`. В
`telegramController.js`: убрать вызовы в `handleContact` (номер не
найден) и `handleSupportMessage` (переоткрытие) — теперь покрыты
`saveIncomingMessage` изнутри; оставить/добавить явный вызов
`supportChat.maybeNotifySupportTeam` в `openSupportThreadForGuest` (там
ещё нет сообщения на момент открытия).

- [x] **Step 3: Прогнать вручную (на dev-данных: написать в поддержку с
  тестового пользователя через `/support/my/start`, убедиться, что
  admin/cb с `telegram_chat_id` получает уведомление; отправить второе
  сообщение сразу — уведомления не будет; подождать/подменить
  `notified_at` в прошлое — третье сообщение уведомляет), commit**

```bash
git add src
git commit -m "fix(поддержка): уведомление на любое новое сообщение, throttled, включая web-треды"
```

---

### Task 2: `/support` — экран сотрудника

**Files:** Create: `web/src/api/support.ts`,
`web/src/features/support/*` + тесты, `useMySupport.ts`, css
Modify: `contract.ts` (`SupportThread`, `SupportMessage`, `FaqItem`),
`routes.tsx`, `NavItems.ts`

**Interfaces:** `supportApi.myThreads()`, `.myThread(id)`,
`.start(topic, text)`, `.reply(threadId, text)`, `.faq()`

- [x] **Step 1: Тесты**

Нет открытого треда → форма создания; есть → переписка + поле ответа;
FAQ рендерится списком вопрос/ответ; пункт «Поддержка» в меню виден без
проверки прав (любая роль).

- [x] **Step 2: Реализация**

`SupportScreen` — переключение форма/переписка по наличию треда.
Поллинг открытого треда 20с (`refetchInterval`).

- [x] **Step 3: Прогнать вручную (создать тред на dev-данных с тестового
  пользователя, ответить из старого клиента админкой, убедиться что
  ответ приходит в новом клиенте по поллингу), commit**

```bash
git add web/src
git commit -m "feat(web): раздел «Поддержка» — обращения сотрудника"
```

---

### Task 3: `/admin/support` — список и детали

**Files:** Create: `web/src/features/admin/support/{SupportInboxScreen,
ThreadList,ThreadDetail}.tsx` + тесты, `useSupportInbox.ts`, css
Modify: `web/src/api/support.ts`, `contract.ts`, `AdminHub.tsx`,
`routes.tsx`

**Interfaces:** `supportApi.adminThreads(filters)`, `.adminThread(id)`,
`.adminReply(threadId, text)`, `.close(threadId)`, `.unreadCount()`

- [x] **Step 1: Тесты**

Фильтры уходят в запрос; строка с непрочитанным подсвечена; узкий экран —
список/детали переключаются, не сплит.

- [x] **Step 2: Реализация**

Список + поиск/фильтры + детали + поллинг 20с. Карточка в `AdminHub` на
`support:manage`.

- [x] **Step 3: Прогнать вручную (на dev-данных: открыть инбокс, найти
  тестовый тред из Task 2 по поиску, ответить, убедиться что ответ дошёл
  до сотрудника), commit**

```bash
git add web/src
git commit -m "feat(web): раздел «Чат поддержки» — инбокс, список и переписка"
```

---

### Task 4: Привязка к сотруднику, архив/удаление

**Files:** Create: `web/src/features/admin/support/LinkEmployeePanel.tsx` + тест
Modify: `SupportInboxScreen.tsx`, `useSupportInbox.ts`

**Interfaces:** `supportApi.linkEmployee(threadId, userId)`,
`.archive(threadId)`, `.unarchive(threadId)`, `.delete(threadId)`

- [x] **Step 1: Тест**

Поиск по ФИО фильтрует список сотрудников; подтверждение предупреждает
о переносе Telegram, если уже привязан к другому; кнопки архива/удаления
скрыты не-admin ролям (cb с `support:manage`, но не `role==='admin'`).

- [x] **Step 2: Реализация**

- [x] **Step 3: Прогнать вручную (на dev-данных: привязать тестовый
  гостевой тред к тестовому сотруднику, убедиться что пароль ушёл в
  Telegram — либо, если Telegram недоступен, что сервер откатился на
  текстовое сообщение), commit**

```bash
git add web/src
git commit -m "feat(web): привязка треда к сотруднику, архив/удаление"
```

---

### Task 5: Готовые фразы и FAQ

**Files:** Create: `web/src/features/admin/support/SupportSettingsSheet.tsx` + тест
Modify: `SupportInboxScreen.tsx`

**Interfaces:** `supportApi.quickReplies(audience)`,
`.saveQuickReply(...)`, `.deleteQuickReply(id)`, `.faq()`, `.saveFaq(...)`,
`.deleteFaq(id)`

- [x] **Step 1: Тест**

Три вкладки (фразы для админов / вопросы-кнопки для гостей / FAQ)
переключаются независимо; подсказка фразы в поле ответа вставляет текст,
не отправляет само сообщение.

- [x] **Step 2: Реализация**

- [x] **Step 3: Прогнать вручную (добавить тестовую готовую фразу на
  dev-данных, вставить её в ответ из ThreadDetail), commit**

```bash
git add web/src
git commit -m "feat(web): готовые фразы, вопросы-кнопки и FAQ поддержки"
```

---

### Task 6: Финальная проверка этапа

- [x] **Step 1:** `npm test`, `npm --prefix web test`, `npm --prefix web run build`
- [x] **Step 2:** Сквозная проверка прав — `/support` открывается под
  любой ролью; `/admin/support` — 403/скрыт без `support:manage`.
- [x] **Step 3:** Телефон 375px — инбокс не ломает раскладку
  (список↔детали, не сплит).
- [x] **Step 4:** Commit

```bash
git commit -m "docs: этап 8 (поддержка) — план выполнен целиком" --allow-empty
```
