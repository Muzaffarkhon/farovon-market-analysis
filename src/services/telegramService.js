const config = require('../config');
const { queryAll } = require('../db/database');

let bot = null;

function getBot() {
  if (bot) return bot;
  if (!config.telegramBotToken) return null;

  try {
    const TelegramBot = require('node-telegram-bot-api');
    bot = new TelegramBot(config.telegramBotToken, { polling: false });
  } catch (e) {
    console.warn('Telegram bot initialization skipped (no token or module):', e.message);
  }
  return bot;
}

async function sendTelegramMessage(chatId, text, options = {}) {
  const tg = getBot();
  if (!tg || !chatId) return false;

  try {
    await tg.sendMessage(chatId, text, { parse_mode: 'HTML', ...options });
    return true;
  } catch (err) {
    console.error(`Failed to send Telegram message to ${chatId}:`, err.message);
    return false;
  }
}

async function sendMassReminder(senderFio = 'Администрация C&B') {
  const divisions = await queryAll('SELECT unit, resp, head, hrbp FROM divisions');
  const competitors = await queryAll('SELECT unit, actual FROM competitors');

  const unitCounts = {};
  competitors.forEach(c => {
    if (!unitCounts[c.unit]) unitCounts[c.unit] = { total: 0, done: 0 };
    unitCounts[c.unit].total++;
    const act = (c.actual || '').toLowerCase();
    if (act === 'актуально' || act === 'не актуально') unitCounts[c.unit].done++;
  });

  const uncompletedUnits = [];
  divisions.forEach(d => {
    const c = unitCounts[d.unit] || { total: 0, done: 0 };
    if (c.total === 0 || c.done < c.total) {
      uncompletedUnits.push(d);
    }
  });

  // Ищем пользователей с telegram_chat_id или телефонами
  const users = await queryAll('SELECT login, fio, phone, telegram_chat_id, units FROM users WHERE active = 1');
  let sentCount = 0;

  for (const u of users) {
    if (!u.telegram_chat_id) continue;
    const uUnits = (u.units || '').split(';').map(s => s.trim()).filter(Boolean);
    const userUncompleted = uncompletedUnits.filter(d => uUnits.includes(d.unit) || d.resp === u.fio || d.head === u.fio);

    if (userUncompleted.length > 0) {
      const msg = `👋 Здравствуйте, <b>${u.fio}</b>!\n\n` +
        `Напоминаем о необходимости завершить заполнение формы <b>«Обзор рынка труда и заработных плат»</b>.\n\n` +
        `Осталось заполнить подразделений: <b>${userUncompleted.length}</b>:\n` +
        userUncompleted.slice(0, 5).map(x => `• ${x.unit}`).join('\n') +
        (userUncompleted.length > 5 ? `\n• ... и ещё ${userUncompleted.length - 5}` : '') +
        `\n\n🔗 Пожалуйста, перейдите в форму и сохраните актуальные данные.`;

      const ok = await sendTelegramMessage(u.telegram_chat_id, msg);
      if (ok) sentCount++;
    }
  }

  return { ok: true, sent: sentCount, uncompletedCount: uncompletedUnits.length };
}

module.exports = {
  getBot,
  sendTelegramMessage,
  sendMassReminder
};
