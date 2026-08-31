const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { queryOne, queryAll, run } = require('../db/database');
const { getBotUsername, sendTelegramMessage, answerCallbackQuery } = require('../services/telegramService');

const LINK_TTL_MINUTES = 10;

// Все сообщения бота уходят с parse_mode: 'HTML' (см. telegramService). ФИО и
// логин вводит администратор — символы < > & в них ломают разметку, а то и
// подставляют теги. Экранируем перед вставкой в текст сообщения.
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const HELP_TEXT = 'Доступные команды:\n' +
  '/login — получить логин и пароль для входа\n' +
  '/status — мои подразделения и прогресс заполнения\n' +
  '/unlink — отвязать этот Telegram от аккаунта\n' +
  '/link — привязать по номеру телефона\n' +
  '/help — этот список';

/** Пользователь запрашивает ссылку для привязки своего Telegram — одноразовый токен
 *  на 10 минут, чтобы чужой чат нельзя было привязать к чужому логину по угадыванию. */
exports.link = async (req, res) => {
  if (!config.telegramBotToken) {
    return res.status(503).json({ ok: false, error: 'Telegram-бот не подключён' });
  }
  const username = await getBotUsername();
  if (!username) {
    return res.status(503).json({ ok: false, error: 'Не удалось связаться с Telegram-ботом' });
  }

  const token = crypto.randomBytes(16).toString('hex');

  // Срок действия считаем в SQL, а не в JS: telegram_link_expires должен сравниваться
  // с datetime('now') строкой-в-строку (webhook ниже делает "expires > datetime('now')"),
  // а new Date().toISOString() даёт другой формат ("...T...Z" против "... ..."),
  // из-за чего сравнение сравнивало бы разные форматы и ссылка не истекала бы никогда.
  await run(
    `UPDATE users SET telegram_link_token = ?, telegram_link_expires = datetime('now', '+${LINK_TTL_MINUTES} minutes') WHERE id = ?`,
    [token, req.user.id]
  );

  res.json({
    ok: true,
    deepLink: `https://t.me/${username}?start=${token}`,
    expiresInMinutes: LINK_TTL_MINUTES
  });
};

/** Отвязка из самого приложения (кнопка «Telegram привязан» → «Отвязать» в профиле). */
exports.unlink = async (req, res) => {
  try {
    await run('UPDATE users SET telegram_chat_id = NULL WHERE id = ?', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Telegram unlink error:', err);
    res.status(500).json({ ok: false, error: 'Не удалось отвязать Telegram' });
  }
};

/** Найти живого пользователя по chat_id — общая проверка для команд ниже. */
async function findByChatId(chatId) {
  return queryOne(
    'SELECT id, fio, units FROM users WHERE telegram_chat_id = ? AND archived_at IS NULL AND active = 1',
    [String(chatId)]
  );
}

const NOT_LINKED_MSG = 'Аккаунт не привязан. Откройте приложение «Обзор рынка» → Профиль → «Привязать Telegram».';

/**
 * Последние 9 цифр — локальный номер без кода страны (+992) и без ведущих
 * нулей/плюсов, в любом написании. И users.phone, и Telegram-контакт
 * сравниваются в этом виде — форматы у них исторически расходятся
 * (с кодом страны/без, с ведущим нулём/без).
 */
function normalizePhone(raw) {
  return String(raw || '').replace(/\D/g, '').slice(-9);
}

/** Клавиатура «поделиться номером» — request_contact сам просит у Telegram
 *  разрешение и подставляет ровно тот номер, что привязан к аккаунту
 *  пользователя, руками вводить/подделать нельзя. */
const CONTACT_KEYBOARD = {
  reply_markup: {
    keyboard: [[{ text: '📱 Отправить номер телефона', request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true
  }
};
const REMOVE_KEYBOARD = { reply_markup: { remove_keyboard: true } };

/**
 * Диплинк с токеном не всегда доезжает как готовое сообщение — часть клиентов
 * Telegram (особенно если чат с ботом уже когда-то открывали) просто
 * открывает чат, не подставляя «/start <токен>» в поле ввода, и человек
 * видит «ничего не произошло». Поэтому даже при невалидном/просроченном
 * токене не останавливаемся на ошибке, а сразу предлагаем более надёжный
 * способ — поделиться номером телефона одной кнопкой.
 */
/** Генерация читаемого и надёжного временного пароля */
function generateTempPassword() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  // Гарантируем цифру и букву: заменяем два первых символа на заведомо
  // цифру и заведомо букву (позиции случайны за счёт остального кода).
  code = '23456789'[crypto.randomInt(0, 8)] + 'ABCDEFGHJKLMNPQRSTUVWXYZ'[crypto.randomInt(0, 24)] + code.slice(2);
  return 'Fv-' + code;
}

/**
 * Сбрасывает пароль пользователю и присылает новый ему в личный чат Telegram.
 * Общий код для двух точек входа:
 *   - команда /login в боте (сам пользователь);
 *   - админское «Сбросить пароль» в приложении — новый пароль уходит
 *     пользователю, администратор его НЕ видит (пароль знает только владелец).
 *
 * `user` — строка из users с полями id, login, fio, telegram_chat_id.
 * `source` — 'self' | 'admin' (только для записи в журнал).
 * Возвращает { ok:true } либо { ok:false, reason:'not_linked'|'system_admin'|'not_found' }.
 */
async function resetAndSendCredentials(user, source) {
  if (!user) return { ok: false, reason: 'not_found' };
  if (user.login === 'admin') return { ok: false, reason: 'system_admin' };
  if (!user.telegram_chat_id) return { ok: false, reason: 'not_linked' };

  const tempPassword = generateTempPassword();
  const platformUrl = config.webappUrl || 'https://farovon-market-analysis.onrender.com';

  const msg = `🔐 <b>Данные для входа в систему «Обзор рынка»:</b>\n\n` +
    `👤 <b>Логин:</b> <code>${escHtml(user.login)}</code>\n` +
    `🔑 <b>Временный пароль:</b> <code>${escHtml(tempPassword)}</code>\n\n` +
    `⚠️ <i>Рекомендуем сменить этот пароль в профиле сразу после входа.</i>\n\n` +
    `🌐 <b>Ссылка на платформу:</b>\n${platformUrl}`;

  // Сначала пытаемся доставить — и только если ушло, меняем хэш. Иначе при
  // недоступном боте пароль бы уже сменился, а пользователь остался бы без
  // нового (лок-аут).
  const sent = await sendTelegramMessage(user.telegram_chat_id, msg, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🚀 Открыть «Обзор рынка»', url: platformUrl }]
      ]
    }
  });
  if (!sent) return { ok: false, reason: 'send_failed' };

  await run('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?', [
    bcrypt.hashSync(tempPassword, 12),
    new Date().toISOString(),
    user.id
  ]);

  await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
    user.login,
    source === 'admin' ? 'сброс пароля админом (выслан в telegram)' : 'сброс пароля telegram',
    source === 'admin'
      ? `Новый пароль для ${user.fio} сгенерирован и отправлен пользователю в Telegram`
      : `Пользователь ${user.fio} запросил данные для входа через Telegram`
  ]);

  return { ok: true };
}

exports.resetAndSendCredentials = resetAndSendCredentials;

/** Запрос логина и генерация нового пароля после привязки Telegram */
async function handleLogin(chatId) {
  const user = await queryOne(
    'SELECT id, login, fio, telegram_chat_id FROM users WHERE telegram_chat_id = ? AND archived_at IS NULL AND active = 1',
    [String(chatId)]
  );
  if (!user) {
    await sendTelegramMessage(chatId, NOT_LINKED_MSG, REMOVE_KEYBOARD);
    return;
  }

  const result = await resetAndSendCredentials(user, 'self');
  if (!result.ok && result.reason === 'system_admin') {
    await sendTelegramMessage(
      chatId,
      '⚠️ Пароль системного администратора не может быть сброшен через Telegram-бота. Обратитесь к системному инженеру.'
    );
  }
}

async function handleStart(chatId, token) {
  if (token) {
    const user = await queryOne(
      "SELECT id, fio FROM users WHERE telegram_link_token = ? AND telegram_link_expires > datetime('now')",
      [token]
    );
    if (user) {
      await run('UPDATE users SET telegram_chat_id = ?, telegram_link_token = NULL, telegram_link_expires = NULL WHERE id = ?', [
        String(chatId),
        user.id
      ]);
      await sendTelegramMessage(chatId,
        `Готово, ${escHtml(user.fio)}! Telegram привязан — теперь сюда будут приходить напоминания о заполнении обзора рынка.\n\n${HELP_TEXT}`,
        REMOVE_KEYBOARD);
      return;
    }
  }

  const already = await findByChatId(chatId);
  if (already) {
    await sendTelegramMessage(chatId, `Здравствуйте, ${escHtml(already.fio)}! Аккаунт уже привязан.\n\n${HELP_TEXT}`, REMOVE_KEYBOARD);
    return;
  }

  await sendTelegramMessage(chatId,
    'Здравствуйте! Чтобы привязать аккаунт, нажмите кнопку ниже и поделитесь номером телефона — ' +
    'найдём вас по номеру, указанному в приложении «Обзор рынка» (спросите HR BP или администратора, ' +
    'если номер ещё не занесён).',
    CONTACT_KEYBOARD);
}

/** Привязка по общему номеру телефона — резервный путь, когда диплинк из
 *  приложения не подставился (см. комментарий к handleStart). */
async function handleContact(chatId, fromId, contact) {
  if (!contact || !contact.phone_number) return;
  // Кнопка request_contact всегда шлёт контакт нажавшего, но Telegram технически
  // допускает и ручную пересылку чужой карточки через скрепку — проверяем,
  // что это правда собственный номер отправителя, а не чей-то ещё.
  if (contact.user_id && fromId && contact.user_id !== fromId) {
    await sendTelegramMessage(chatId, 'Поделитесь своим собственным номером, не чужим.');
    return;
  }

  const norm = normalizePhone(contact.phone_number);
  if (!norm) {
    await sendTelegramMessage(chatId, 'Не удалось распознать номер.', REMOVE_KEYBOARD);
    return;
  }

  const users = await queryAll(
    "SELECT id, fio, phone FROM users WHERE archived_at IS NULL AND active = 1 AND TRIM(COALESCE(phone,'')) <> ''"
  );
  const match = users.find(u => normalizePhone(u.phone) === norm);

  if (!match) {
    await sendTelegramMessage(chatId,
      'Не нашли сотрудника с таким номером в приложении «Обзор рынка». Проверьте номер в профиле ' +
      '(Админка → Пользователи) или привяжите аккаунт по ссылке из приложения.',
      REMOVE_KEYBOARD);
    return;
  }

  await run('UPDATE users SET telegram_chat_id = ?, telegram_link_token = NULL, telegram_link_expires = NULL WHERE id = ?', [
    String(chatId),
    match.id
  ]);
  await sendTelegramMessage(chatId,
    `Готово, ${escHtml(match.fio)}! Telegram привязан по номеру телефона.\n\n${HELP_TEXT}`,
    REMOVE_KEYBOARD);
}

/** «Мои подразделения» — тот же прогресс, что на экране «Мои подразделения» в приложении,
 *  но коротким текстом: не тянем сюда весь getUserPayload, только счётчики. */
async function handleStatus(chatId) {
  const user = await findByChatId(chatId);
  if (!user) { await sendTelegramMessage(chatId, NOT_LINKED_MSG); return; }

  const unitsList = (user.units || '').split(';').map(s => s.trim()).filter(Boolean);
  if (!unitsList.length) {
    await sendTelegramMessage(chatId, `Здравствуйте, ${escHtml(user.fio)}! За вами пока не закреплено подразделение — обратитесь к администратору.`);
    return;
  }

  const placeholders = unitsList.map(() => '?').join(',');
  const comps = await queryAll(`SELECT actual FROM competitors WHERE unit IN (${placeholders})`, unitsList);
  const survs = await queryAll(
    `SELECT id FROM surveys WHERE state != 'удалена' AND unit IN (${placeholders})`, unitsList);

  let done = 0;
  comps.forEach(c => {
    const act = (c.actual || '').toLowerCase();
    if (act === 'актуально' || act === 'не актуально') done++;
  });

  const unitLines = unitsList.slice(0, 10).map(u => '• ' + u).join('\n') +
    (unitsList.length > 10 ? `\n• и ещё ${unitsList.length - 10}` : '');

  await sendTelegramMessage(chatId,
    `📊 <b>${escHtml(user.fio)}</b>\n\n` +
    `Подразделений: <b>${unitsList.length}</b>\n` +
    `Участников рынка: <b>${done}/${comps.length}</b> проверено\n` +
    `Записей по должностям: <b>${survs.length}</b>\n\n${unitLines}`);
}

/**
 * Раньше /unlink спрашивал подтверждение inline-кнопками (callback_query) —
 * пользователь сообщил, что кнопки не срабатывали (либо задержка холодного
 * старта на бесплатном Render, либо сам механизм callback_query ненадёжен
 * для этого бота — воспроизвести из кода не удалось). Убрал промежуточный
 * шаг совсем: отвязка — не то действие, которое опасно сделать случайно
 * (привязать обратно можно тут же командой /link), а у самого приложения
 * уже есть свой explicit-confirm через ask() для того же действия.
 */
async function handleUnlink(chatId) {
  const user = await findByChatId(chatId);
  if (!user) { await sendTelegramMessage(chatId, NOT_LINKED_MSG); return; }

  await run('UPDATE users SET telegram_chat_id = NULL WHERE id = ?', [user.id]);
  await sendTelegramMessage(chatId, `Telegram отвязан от аккаунта ${escHtml(user.fio)}. Привязать заново — командой /link.`);
}

/** Старые сообщения с inline-кнопками «Да, отвязать»/«Отмена» могли остаться
 *  в истории чата у тех, кто видел прошлую версию /unlink, — без ответа на
 *  callback_query кнопка так и висит с крутящимся индикатором. Отвечаем, но
 *  саму отвязку через кнопки больше не делаем (см. handleUnlink выше). */
async function handleStaleCallback(cb) {
  await sendTelegramMessage(
    (cb.message && cb.message.chat && cb.message.chat.id) || (cb.from && cb.from.id),
    'Эта кнопка устарела. Наберите /unlink ещё раз.'
  );
  await answerCallbackQuery(cb.id);
}

/** Публичный эндпоинт — сюда Telegram шлёт входящие сообщения после setWebHook.
 *  Секретный заголовок проверяем сами: без него любой мог бы слать сюда что угодно
 *  от имени бота. */
/** Сравнение секретов за постоянное время — чтобы по времени ответа нельзя
 *  было побайтово подобрать секрет. Разная длина → сразу не совпало. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

exports.webhook = async (req, res) => {
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (!config.telegramWebhookSecret || !safeEqual(secret, config.telegramWebhookSecret)) {
    return res.status(401).end();
  }

  // Telegram ждёт быстрый 200 независимо от результата обработки — иначе будет
  // повторять доставку. Обрабатываем и подтверждаем сразу.
  res.status(200).end();

  try {
    const cb = req.body && req.body.callback_query;
    if (cb) { await handleStaleCallback(cb); return; }

    const msg = req.body && req.body.message;
    if (!msg || !msg.chat) return;

    const chatId = msg.chat.id;

    if (msg.contact) {
      await handleContact(chatId, msg.from && msg.from.id, msg.contact);
      return;
    }

    if (!msg.text) return;
    const text = msg.text.trim();

    const startMatch = text.match(/^\/start(?:\s+([a-f0-9]{32}))?$/i);
    if (startMatch) { await handleStart(chatId, startMatch[1]); return; }

    // Ручной запасной путь — если диплинк из приложения не подставил
    // /start в поле ввода, человек всё равно может набрать /link сам.
    if (/^\/link\b/i.test(text)) { await handleStart(chatId, null); return; }
    if (/^\/(login|creds|password|pass|dostup)\b/i.test(text)) { await handleLogin(chatId); return; }
    if (/^\/status\b/i.test(text)) { await handleStatus(chatId); return; }
    if (/^\/unlink\b/i.test(text)) { await handleUnlink(chatId); return; }
    if (/^\/help\b/i.test(text)) { await sendTelegramMessage(chatId, HELP_TEXT); return; }

    await sendTelegramMessage(chatId, 'Не понял команду.\n\n' + HELP_TEXT);
  } catch (err) {
    console.error('Telegram webhook error:', err);
  }
};
