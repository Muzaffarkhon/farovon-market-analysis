const crypto = require('crypto');
const config = require('../config');
const { queryOne, run } = require('../db/database');
const { getBotUsername, sendTelegramMessage } = require('../services/telegramService');

const LINK_TTL_MINUTES = 10;

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
    const msg = req.body && req.body.message;
    if (!msg || !msg.text || !msg.chat) return;

    const match = msg.text.trim().match(/^\/start\s+([a-f0-9]{32})$/i);
    if (!match) {
      if (msg.text.trim() === '/start') {
        await sendTelegramMessage(msg.chat.id, 'Здравствуйте! Чтобы привязать аккаунт, откройте ссылку из приложения «Обзор рынка» — раздел меню «Привязать Telegram».');
      }
      return;
    }

    const token = match[1];
    const user = await queryOne(
      "SELECT id, fio FROM users WHERE telegram_link_token = ? AND telegram_link_expires > datetime('now')",
      [token]
    );

    if (!user) {
      await sendTelegramMessage(msg.chat.id, 'Ссылка недействительна или устарела. Сгенерируйте новую в приложении — меню → «Привязать Telegram».');
      return;
    }

    await run('UPDATE users SET telegram_chat_id = ?, telegram_link_token = NULL, telegram_link_expires = NULL WHERE id = ?', [
      String(msg.chat.id),
      user.id
    ]);

    await sendTelegramMessage(msg.chat.id, `Готово, ${user.fio}! Telegram привязан — теперь сюда будут приходить напоминания о заполнении обзора рынка.`);
  } catch (err) {
    console.error('Telegram webhook error:', err);
  }
};
