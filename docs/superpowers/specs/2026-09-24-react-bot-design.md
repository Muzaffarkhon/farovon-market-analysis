# Дизайн: этап 7 — Telegram-бот

Дата: 2026-09-24. Ветка `redesign/react`. Источник требований —
`docs/ТЗ_переписывание_интерфейса_2026-09-22.md`, раздел 8 (плюс раздел 14,
строка «Бот: кнопки, идемпотентность, подпись Mini App, расписание
напоминаний»). Это серверный/бот-этап — раздела в новом React-клиенте не
создаёт (кроме одной точки входа для автовхода, см. §4).

## 1. Зачем

Раздел 8 ТЗ перечисляет пять раздельных дефектов бота. Аудит текущего кода
(`src/services/telegramService.js`, `src/controllers/telegramController.js`)
подтвердил четыре из них как реальные и один — как уже устранённый ранее
(см. §3.1). Отдельно, по решению заказчика от 24.09, в этот же этап входит
шестая вещь, не описанная в ТЗ буквально, но напрашивающаяся из его духа:
раз кнопка «Открыть систему» уже открывает `/new` как Mini App, а подпись
`initData` всё равно нужно проверять, есть смысл сразу сделать по ней вход
без пароля — иначе валидатор подписи повиснет мёртвым кодом без потребителя.

## 2. Область видимости

Изменения — только `src/services/telegramService.js`,
`src/controllers/telegramController.js`, новый
`src/services/reminderService.js`, новая таблица(ы) в `src/db/migrate.js`,
`vercel.json` (добавление `crons`), один новый серверный маршрут
`/api/auth/telegram`, и один клиентский bootstrap-хук в `web/src/app/`.
Существующий вебхук-секрет (`timingSafeEqual`), вход по логину/паролю,
`/link` по диплинку и телефону — не трогаем, они уже корректны.

## 3. Что переделать

### 3.1 Кнопки

**Меню команд (`setMyCommands`).** Аудит показал: код уже обновляет оба
scope (`default` и `all_private_chats`) одним и тем же списком
(`telegramService.js:91-97`, с explaining-комментарием на месте) — это не
баг, а уже применённый обходной манёвр. **Не трогаем.**

**Клавиатуры реально несогласованы** (см. таблицу в аудите): `/start`/
`/link` шлют reply-клавиатуру, затем `REMOVE_KEYBOARD` её стирает и ничего
не восстанавливает; `/login`-успех и рассылки шлют inline; `SUPPORT_KEYBOARD`
(ошибки «не привязан») — тоже inline; `/support` — свою reply-клавиатуру.
Итог: постоянной клавиатуры в диалоге нет вообще, только временные.

**Решение.** Ввести одну функцию `mainReplyKeyboard()` в
`telegramService.js` — reply-клавиатура из трёх кнопок: «🚀 Открыть
систему» (`web_app`, URL как у текущей inline-кнопки,
`telegramController.js:188-200`), «📊 Мой прогресс» (текст `/status`),
«💬 Написать в поддержку» (текст `/support`). Отправлять её после каждого
успешного `/start`, `/link`, `resetAndSendCredentials`, вместо
`REMOVE_KEYBOARD` — клавиатура должна жить всю сессию, а не исчезать после
первого ответа. `SUPPORT_KEYBOARD`, `CONTACT_KEYBOARD` (запрос телефона/
диплинк) остаются как есть — это одноразовые inline-действия внутри
конкретного сообщения, ТЗ их не запрещает, наоборот требует именно такого
разделения. `broadcastController.js:104` — добавить туда же fallback
https/http, которого не хватает (несогласованность, замеченная в аудите,
мелкий побочный фикс).

### 3.2 Идемпотентность вебхука

Новая таблица:

```sql
CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id INTEGER PRIMARY KEY,
  processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

В `exports.webhook` (`telegramController.js:474-492`), сразу после проверки
секрета и до вызова `processTelegramUpdate`: `INSERT OR IGNORE INTO
telegram_updates (update_id) VALUES (?)` — если `changes === 0` (уже была),
сразу `res.status(200).end()` без повторной обработки. Комментарий на месте
объясняет: Telegram может доставить один апдейт дважды при таймауте ответа,
без дедупликации это дублирует записи/сообщения. Старые строки не чистим
отдельным job — `update_id` растут монотонно, а сама таблица маленькая
(один инт на апдейт); если когда-нибудь понадобится TTL — отдельная задача,
не в этом этапе.

### 3.3 `initData` — HMAC-проверка + автовход через Mini App

**Проверка (стандартный алгоритм Telegram).** Новая функция в
`telegramService.js`:

```js
function verifyInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (!hash || computed.length !== hash.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash))) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null; // сутки — как в примерах Telegram
  return JSON.parse(params.get('user') || 'null');
}
```

**Новый маршрут** `POST /api/auth/telegram` — тело `{ initData }`. Логика
зеркалит `authController.login` (`authController.js:542-637`), но без
пароля:

1. `verifyInitData` — если `null`, 401 «Недействительная подпись».
2. Найти `users` по `telegram_chat_id = String(tgUser.id)` (в приватном
   чате `chat.id === user.id` — так уже устроена вся рассылка,
   `broadcastController.js`). Не найден или не активен — тот же ответ, что
   у обычного логина (403/401), без автосоздания учётки: Mini App-вход —
   альтернативный способ пройти уже существующую привязку, не отдельная
   регистрация.
3. Успех — тот же путь, что у `login`: `last_login_at`, запись в
   `audit_log` (action `'вход через Mini App'`), `makeToken`,
   `setSessionCookie`, `getUserPayload(user)`, ответ `{ ok: true, token,
   data }` — идентичный контракт `/auth/login`, клиенту не нужно знать про
   разницу.
4. Rate-limit — тот же `authLimiter`, что на `/auth/login`
   (`src/routes/api.js:26`): подпись валидна только 24 часа и привязана к
   конкретному чату, но лишняя защита от перебора не помешает.

**Клиент.** `web/src/app/` — при старте, если `window.Telegram?.WebApp
?.initData` непусто и обычной сессии ещё нет (`localStorage`/куки), вызвать
`authApi.telegramLogin(initData)` вместо показа экрана входа; при ошибке —
обычный откат на форму логина. Это единственное изменение в `web/` в этом
этапе.

### 3.4 Напоминания — пересчёт охвата

`sendMassReminder` (`telegramService.js:141-184`) читает
`competitors.actual` без фильтра по периоду — источник и заказчик уже
согласились, что колонка упразднена. Переписать на ту же модель, что
`coordinationService.getCoordination` (уже корректно считает
`positionsTotal`/`positionsDecided` по `position_company_selections` +
`surveys` + активный период, используется этапом 4) — **не** копировать
`/status`-логику заново, использовать существующий сервис как источник
истины, раз он уже есть и покрыт тестами. `sendMassReminder` берёт
`coordinationService.getCoordination()`, для каждого юнита с
`positionsDecided < positionsTotal` собирает список ответственных
(`resp`/`hrbp`/`head` юнита — те же роли, что у `coordinationService`),
шлёт `sendTelegramMessage` только тем, у кого `hasTelegram` и есть реально
незакрытое (та же логика неспама, что уже в `coordination/remind`,
`coordinationController.js:23`, — не переизобретаем, вызываем на её основе
для all-юнитов вместо явного списка логинов).

### 3.5 Планировщик

`vercel.json` → `crons`:

```json
"crons": [{ "path": "/api/cron/reminders", "schedule": "0 6 * * *" }]
```

Новый маршрут `POST /api/cron/reminders` (без `requireCapability` —
защищён отдельно, сверкой заголовка `Authorization: Bearer
<CRON_SECRET>` через `timingSafeEqual`, по образцу вебхука; `CRON_SECRET` —
новая переменная окружения). Обработчик — `reminderService.runDaily()`:

- Берёт активный период (`periodService.getActivePeriod`), его `from_date`/
  `to_date`.
- Считает, какой «тир» сегодня: `start` (сегодня == `from_date`), `weekly`
  (кампания идёт и сегодня понедельник — или день недели `from_date`, чтобы
  не зависеть от произвольной календарной недели), `t-14`/`t-7`/`t-1`
  (сегодня ровно N дней до `to_date`). Несколько тиров в один день не
  бывает по построению интервалов, но если случится — шлём один раз,
  приоритет `t-1` > `t-7` > `t-14` > `weekly` > `start`.
- Если тир определён — вызывает `sendMassReminder` (3.4), но только тем,
  у кого действительно есть незакрытое (уже встроено).
- Идемпотентность день-в-день: новая таблица `reminder_log (period_id,
  tier, sent_on DATE, PRIMARY KEY(period_id, tier, sent_on))` —
  `INSERT OR IGNORE` перед рассылкой; `changes === 0` → выходим, тир уже
  отработан сегодня (повторный вызов cron / ручной ретрай не дублирует
  рассылку).
- Работает целиком до ответа (`res.end()`), никаких side-effect'ов после —
  тот же принцип, что уже соблюдён в вебхуке (`telegramController.js:
  480-486`).

## 4. Клиент

Единственное изменение — bootstrap-хук автовхода через `initData`
(§3.3). Экрана, маршрута или пункта меню это не создаёт.

## 5. Тесты

- `telegramService.verifyInitData` — `node --test`: валидная подпись
  (тестовые данные, сгенерированные тем же алгоритмом, с фиктивным
  `botToken`) проходит; тронутое поле, просроченный `auth_date`, отсутствие
  `hash` — отклоняются.
- `authController` / `POST /auth/telegram` — привязанный активный
  пользователь входит и получает тот же контракт, что `/auth/login`;
  непривязанный чат — 401; заблокированный пользователь — 403.
- Вебхук — повторная доставка одного `update_id` обрабатывается один раз
  (проверка по мок-хендлеру: второй вызов не доходит до
  `processTelegramUpdate`).
- `sendMassReminder` — на синтетических `divisions`/
  `position_company_selections`/`surveys`/`users` (без обращения к реальной
  базе, как у `coordinationService.test.js`): юнит без штатки не считается
  «незакрытым», отправка идёт только тем, у кого правда что-то не закрыто,
  человек без `telegram_chat_id` — пропущен, не «отправлено».
- `reminderService.runDaily` — по каждому тиру (start/weekly/t-14/t-7/t-1)
  на фиктивных датах `from_date`/`to_date`; повторный вызов в тот же день
  не шлёт второй раз (проверка через `reminder_log`).
- Маршрут `/api/cron/reminders` — без верного `CRON_SECRET` отдаёт 401.

## 6. Чего здесь нет

Модуля «Чат поддержки» (раздел 9 ТЗ, этап 8 — отдельная спека). Экрана
координации на клиенте — не трогаем (этап 4 уже сделан, `sendMassReminder`
теперь просто использует тот же сервис). Отключения старого интерфейса и
прочих правок безопасности из раздела 12 — этап 9.
