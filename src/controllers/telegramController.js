const crypto = require('crypto');
const config = require('../config');
const { queryOne, queryAll, run } = require('../db/database');
const { getBotUsername, sendTelegramMessage, answerCallbackQuery } = require('../services/telegramService');

const LINK_TTL_MINUTES = 10;

const HELP_TEXT = 'Доступные команды:\n' +
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
        `Готово, ${user.fio}! Telegram привязан — теперь сюда будут приходить напоминания о заполнении обзора рынка.\n\n${HELP_TEXT}`,
        REMOVE_KEYBOARD);
      return;
    }
  }

  const already = await findByChatId(chatId);
  if (already) {
    await sendTelegramMessage(chatId, `Здравствуйте, ${already.fio}! Аккаунт уже привязан.\n\n${HELP_TEXT}`, REMOVE_KEYBOARD);
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
    `Готово, ${match.fio}! Telegram привязан по номеру телефона.\n\n${HELP_TEXT}`,
    REMOVE_KEYBOARD);
}

/** «Мои подразделения» — тот же прогресс, что на экране «Мои подразделения» в приложении,
 *  но коротким текстом: не тянем сюда весь getUserPayload, только счётчики. */
async function handleStatus(chatId) {
  const user = await findByChatId(chatId);
  if (!user) { await sendTelegramMessage(chatId, NOT_LINKED_MSG); return; }

  const unitsList = (user.units || '').split(';').map(s => s.trim()).filter(Boolean);
  if (!unitsList.length) {
    await sendTelegramMessage(chatId, `Здравствуйте, ${user.fio}! За вами пока не закреплено подразделение — обратитесь к администратору.`);
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
    `📊 <b>${user.fio}</b>\n\n` +
    `Подразделений: <b>${unitsList.length}</b>\n` +
    `Участников рынка: <b>${done}/${comps.length}</b> проверено\n` +
    `Записей по должностям: <b>${survs.length}</b>\n\n${unitLines}`);
}

async function handleUnlinkPrompt(chatId) {
  const user = await findByChatId(chatId);
  if (!user) { await sendTelegramMessage(chatId, NOT_LINKED_MSG); return; }

  await sendTelegramMessage(chatId,
    `Отвязать Telegram от аккаунта <b>${user.fio}</b>? Напоминания приходить перестанут.`, {
      reply_markup: {
        inline_keyboard: [[
          { text: 'Да, отвязать', callback_data: 'unlink_confirm' },
          { text: 'Отмена', callback_data: 'unlink_cancel' }
        ]]
      }
    });
}

async function handleCallbackQuery(cb) {
  const chatId = cb.message && cb.message.chat && cb.message.chat.id;
  if (!chatId) return;

  if (cb.data === 'unlink_confirm') {
    const user = await findByChatId(chatId);
    if (user) {
      await run('UPDATE users SET telegram_chat_id = NULL WHERE id = ?', [user.id]);
      await sendTelegramMessage(chatId, 'Telegram отвязан. Привязать заново можно в любой момент через приложение.');
    }
  } else if (cb.data === 'unlink_cancel') {
    await sendTelegramMessage(chatId, 'Отменено, аккаунт остаётся привязан.');
  }

  await answerCallbackQuery(cb.id);
}

/** Публичный эндпоинт — сюда Telegram шлёт входящие сообщения после setWebHook.
 *  Секретный заголовок проверяем сами: без него любой мог бы слать сюда что угодно
 *  от имени бота. */
exports.webhook = async (req, res) => {
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (!config.telegramWebhookSecret || secret !== config.telegramWebhookSecret) {
    return res.status(401).end();
  }

  // Telegram ждёт быстрый 200 независимо от результата обработки — иначе будет
  // повторять доставку. Обрабатываем и подтверждаем сразу.
  res.status(200).end();

  try {
    const cb = req.body && req.body.callback_query;
    if (cb) { await handleCallbackQuery(cb); return; }

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
    if (/^\/status\b/i.test(text)) { await handleStatus(chatId); return; }
    if (/^\/unlink\b/i.test(text)) { await handleUnlinkPrompt(chatId); return; }
    if (/^\/help\b/i.test(text)) { await sendTelegramMessage(chatId, HELP_TEXT); return; }

    await sendTelegramMessage(chatId, 'Не понял команду.\n\n' + HELP_TEXT);
  } catch (err) {
    console.error('Telegram webhook error:', err);
  }
};
