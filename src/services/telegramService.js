const crypto = require('crypto');
const config = require('../config');
const { queryAll } = require('../db/database');

/**
 * Проверка подписи Telegram Mini App (`window.Telegram.WebApp.initData`) —
 * стандартный алгоритм Telegram (WebAppData): секретный ключ — HMAC-SHA256
 * токена бота с константой 'WebAppData', сама подпись — HMAC-SHA256
 * data-check-string этим ключом. Возвращает распарсенный `user` из initData
 * при валидной и свежей (не старше суток — как в примерах Telegram)
 * подписи, иначе null. Не бросает исключений — вызывающий код сам решает,
 * что ответить (401), а не ловит их сначала.
 */
function verifyInitData(initData, botToken = config.telegramBotToken) {
  if (!initData || !botToken) return null;
  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const bufComputed = Buffer.from(computed, 'hex');
  const bufHash = Buffer.from(hash, 'hex');
  if (bufComputed.length !== bufHash.length || !crypto.timingSafeEqual(bufComputed, bufHash)) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

  try {
    return JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
}

// Все сообщения бота уходят с parse_mode: 'HTML'. ФИО и названия подразделений
// вводит администратор — символы < > & в них ломают разметку. Экранируем.
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let bot = null;
let botUsername = null;

function getBot() {
  if (bot) return bot;
  if (!config.telegramBotToken) return null;

  try {
    // node-telegram-bot-api v2: класс Api — прямой клиент Bot API без поллинга
    // и без встроенного парсинга апдейтов (вебхук разбираем сами в telegramController).
    const { Api } = require('node-telegram-bot-api');
    bot = new Api(config.telegramBotToken);
  } catch (e) {
    console.warn('Telegram bot initialization skipped (no token or module):', e.message);
  }
  return bot;
}

/** Юзернейм бота — нужен, чтобы собрать диплинк t.me/<username>?start=<token>. Спрашиваем
 *  у Telegram один раз при старте и держим в памяти, вместо ещё одной переменной окружения. */
async function getBotUsername() {
  if (botUsername) return botUsername;
  const tg = getBot();
  if (!tg) return null;
  try {
    const me = await tg.getMe();
    botUsername = me.username;
    return botUsername;
  } catch (err) {
    console.warn('Не удалось получить username бота (getMe):', err.message);
    return null;
  }
}

// Список команд для меню бота (кнопка «Меню» в Telegram). До этой правки
// там висел набор от прошлой (Apps Script) версии бота — /start и /help с
// чужими описаниями и /login «Показать мой логин и пароль», которого в этом
// боте вообще нет. Telegram хранит меню на своей стороне, а не берёт его из
// кода при каждом сообщении — обновляется только явным вызовом setMyCommands.
const BOT_COMMANDS = [
  { command: 'start', description: 'Привязать аккаунт' },
  { command: 'login', description: 'Получить логин и пароль для входа' },
  { command: 'status', description: 'Мои подразделения и прогресс' },
  { command: 'unlink', description: 'Отвязать этот Telegram от аккаунта' },
  { command: 'link', description: 'Привязать по номеру телефона' },
  { command: 'support', description: 'Написать в чат поддержки' },
  { command: 'help', description: 'Список команд' }
];

/** Регистрирует вебхук в Telegram, чтобы бот мог принимать входящие сообщения — без
 *  этого он умеет только отправлять. Вызывается один раз при старте сервера; ошибка
 *  не должна мешать серверу подняться, поэтому не бросает исключение наружу. */
async function ensureWebhook() {
  const tg = getBot();
  if (!tg || !config.webappUrl || config.webappUrl.indexOf('localhost') >= 0) return;
  if (!config.telegramWebhookSecret) {
    console.warn('⚠️ TELEGRAM_WEBHOOK_SECRET не задан — вебхук Telegram не регистрируется.');
    return;
  }
  try {
    await tg.setWebhook({
      url: `${config.webappUrl}/api/telegram/webhook`,
      secret_token: config.telegramWebhookSecret,
      // Явно, а не по умолчанию: без callback_query нажатия кнопки «Написать
      // администратору» (чат поддержки) вообще не доедут до вебхука.
      allowed_updates: ['message', 'callback_query']
    });
    await getBotUsername();
    console.log(`✅ Telegram webhook зарегистрирован (@${botUsername || '?'})`);
  } catch (err) {
    console.warn('⚠️ Не удалось зарегистрировать Telegram webhook:', err.message);
  }

  // scope 'default' и scope 'all_private_chats' — два независимых списка на
  // стороне Telegram, 'all_private_chats' приоритетнее и молча перекрывает
  // 'default' в личных чатах (весь диалог с этим ботом). У старой, ещё
  // Apps-Script версии бота был задан свой список именно под этим scope —
  // без него обновление 'default' в личке никогда не показывалось, хотя
  // формально проходило без ошибок. Обновляем оба, чтобы больше не зависеть
  // от того, какой из них Telegram выберет.
  for (const scope of [undefined, { type: 'all_private_chats' }]) {
    try {
      await tg.setMyCommands(scope ? { commands: BOT_COMMANDS, scope } : { commands: BOT_COMMANDS });
    } catch (err) {
      console.warn('⚠️ Не удалось обновить меню команд Telegram' + (scope ? ` (scope ${scope.type})` : '') + ':', err.message);
    }
  }
}

async function sendTelegramMessage(chatId, text, options = {}) {
  const tg = getBot();
  if (!tg || !chatId) return false;

  try {
    await tg.sendMessage({ chat_id: chatId, text, parse_mode: 'HTML', ...options });
    return true;
  } catch (err) {
    console.error(`Failed to send Telegram message to ${chatId}:`, err.message);
    return false;
  }
}

/** Скачивает файл, присланный боту (getFile → прямая ссылка на файл Bot API),
 *  и возвращает его содержимое как Buffer — используется прикреплением файлов
 *  к заявкам на пересмотр ЗП (comp-review). Telegram сам не отдаёт ботам файлы
 *  тяжелее ~20 МБ через getFile — этим и ограничен размер вложения. */
async function downloadTelegramFile(fileId) {
  const tg = getBot();
  if (!tg) throw new Error('Telegram-бот не подключён');
  const info = await tg.getFile({ file_id: fileId });
  if (!info || !info.file_path) throw new Error('Telegram не вернул путь к файлу');
  const resp = await fetch(`https://api.telegram.org/file/bot${config.telegramBotToken}/${info.file_path}`);
  if (!resp.ok) throw new Error('Не удалось скачать файл из Telegram');
  return Buffer.from(await resp.arrayBuffer());
}

/** Убирает "часики" на нажатой inline-кнопке — без этого Telegram сам снимет их
 *  через несколько секунд таймаутом, но кнопка выглядит зависшей. */
async function answerCallbackQuery(callbackQueryId, text) {
  const tg = getBot();
  if (!tg || !callbackQueryId) return false;
  try {
    await tg.answerCallbackQuery({ callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
    return true;
  } catch (err) {
    console.error('Failed to answer Telegram callback query:', err.message);
    return false;
  }
}

/** Уведомление о новом сообщении в чате поддержки — всем admin/cb с привязанным
 *  Telegram, тем же способом, что и sendMassReminder ниже. */
async function notifySupportTeam(text) {
  const users = await queryAll(
    "SELECT telegram_chat_id FROM users WHERE active = 1 AND role IN ('admin', 'cb') AND telegram_chat_id IS NOT NULL"
  );
  let sentCount = 0;
  for (const u of users) {
    const ok = await sendTelegramMessage(u.telegram_chat_id, text);
    if (ok) sentCount++;
  }
  return sentCount;
}

// `coordinationService.getCoordination().people` (тот же ответ, что уходит
// клиенту на экран «Координация») сознательно не несёт telegram_chat_id —
// только hasTelegram. Для реальной отправки берём его отдельным точечным
// запросом, только для тех логинов, кому действительно будем писать —
// общий хелпер для sendMassReminder и sendCoordinationReminder ниже.
async function chatIdsForLogins(logins) {
  const unique = Array.from(new Set(logins));
  if (!unique.length) return new Map();
  const rows = await queryAll(
    `SELECT login, telegram_chat_id FROM users WHERE login IN (${unique.map(() => '?').join(',')})`,
    unique
  );
  return new Map(rows.map(r => [r.login, r.telegram_chat_id]));
}

/**
 * Кто получает массовое напоминание: люди с привязанным Telegram, у
 * которых хотя бы в одном ИЗ СВОИХ подразделений есть незакрытая
 * должность. Подразделение без штатки (`positionsTotal === 0`) не в счёт —
 * `positionsDecided < positionsTotal` для него ложно по построению
 * `coordinationService.buildCoordination`. Чистая функция — тестируется на
 * синтетических `units`/`people`, без обращения к реальной базе.
 */
function selectReminderCandidates({ units, people }) {
  const unitByName = new Map(units.map(u => [u.unit, u]));
  return people.filter(p => p.hasTelegram && p.units.some(name => {
    const info = unitByName.get(name);
    return info && info.positionsDecided < info.positionsTotal;
  }));
}

/**
 * Массовая рассылка по кампании — всем, у кого правда есть незакрытые
 * должности в подразделениях, за которые они отвечают (`users.units`, либо
 * `resp`/`head` подразделения). Раньше считала охват по упразднённому
 * флагу `competitors.actual` без фильтра по периоду — фактически не
 * работала (см. хендофф 22.09.2026). Теперь — та же модель данных, что уже
 * использует `coordinationService.getCoordination` (этап 4, экран
 * «Координация» и `/status` в боте): `position_company_selections` +
 * `surveys` активного периода.
 */
async function sendMassReminder(senderFio = 'Администрация C&B') {
  const { getCoordination } = require('./coordinationService');
  const { units, people } = await getCoordination();
  const unitByName = new Map(units.map(u => [u.unit, u]));

  const candidates = selectReminderCandidates({ units, people });
  const chatIdByLogin = await chatIdsForLogins(candidates.map(p => p.login));

  let sentCount = 0;
  for (const person of candidates) {
    const chatId = chatIdByLogin.get(person.login);
    if (!chatId) continue;

    const incomplete = person.units
      .map(u => unitByName.get(u))
      .filter(u => u && u.positionsDecided < u.positionsTotal);

    const msg = `👋 Здравствуйте, <b>${escHtml(person.fio)}</b>!\n\n` +
      `Напоминаем о необходимости завершить заполнение формы <b>«Обзор рынка труда и заработных плат»</b>.\n\n` +
      `Осталось заполнить подразделений: <b>${incomplete.length}</b>:\n` +
      incomplete.slice(0, 5).map(u => `• ${escHtml(u.unit)} (${u.positionsDecided} из ${u.positionsTotal})`).join('\n') +
      (incomplete.length > 5 ? `\n• ... и ещё ${incomplete.length - 5}` : '') +
      `\n\n🔗 Пожалуйста, перейдите в форму и сохраните актуальные данные.`;

    const ok = await sendTelegramMessage(chatId, msg);
    if (ok) sentCount++;
  }

  const uncompletedCount = units.filter(u => u.positionsDecided < u.positionsTotal).length;
  return { ok: true, sent: sentCount, uncompletedCount };
}

/**
 * Точечное напоминание выбранным людям с экрана «Координация» (ТЗ 1.4) —
 * персональный список ЕГО незакрытых подразделений, не всего холдинга.
 *
 * `unitFilter` — тот же предикат видимости, что у отправителя на экране:
 * логин вне его области действия молча пропускается, а не отправляет ему
 * чужое напоминание в обход прав.
 */
async function sendCoordinationReminder(logins, { unitFilter, senderFio = 'HR BP' } = {}) {
  const { getCoordination } = require('./coordinationService');
  const { units, people } = await getCoordination({}, { unitFilter });
  const unitByName = new Map(units.map(u => [u.unit, u]));
  const peopleByLogin = new Map(people.map(p => [p.login, p]));

  const wanted = Array.from(new Set(logins || []));
  const chatIdByLogin = await chatIdsForLogins(wanted);

  let sent = 0;
  let skipped = 0;

  for (const login of wanted) {
    const person = peopleByLogin.get(login);
    const chatId = chatIdByLogin.get(login);
    if (!person || !person.hasTelegram || !chatId) { skipped++; continue; }

    const incomplete = person.units
      .map(u => unitByName.get(u))
      .filter(u => u && u.positionsDecided < u.positionsTotal);

    if (!incomplete.length) { skipped++; continue; }

    const msg = `👋 Здравствуйте, <b>${escHtml(person.fio)}</b>!\n\n` +
      `${escHtml(senderFio)} просит дозаполнить рынок по вашим подразделениям.\n\n` +
      `Незакрытые должности:\n` +
      incomplete.slice(0, 5).map(u => `• ${escHtml(u.unit)} (${u.positionsDecided} из ${u.positionsTotal})`).join('\n') +
      (incomplete.length > 5 ? `\n• ... и ещё ${incomplete.length - 5}` : '') +
      `\n\n🔗 Пожалуйста, перейдите в форму и сохраните актуальные данные.`;

    const ok = await sendTelegramMessage(chatId, msg);
    if (ok) sent++; else skipped++;
  }

  // Логины вне области видимости отправителя (не нашлись среди people) —
  // тоже пропущены, а не тихо проигнорированы в счётчике.
  skipped += wanted.filter(l => !peopleByLogin.has(l)).length;

  return { sent, skipped };
}

module.exports = {
  getBot,
  getBotUsername,
  ensureWebhook,
  sendTelegramMessage,
  downloadTelegramFile,
  answerCallbackQuery,
  verifyInitData,
  sendMassReminder,
  selectReminderCandidates,
  sendCoordinationReminder,
  notifySupportTeam
};
