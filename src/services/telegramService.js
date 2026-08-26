const config = require('../config');
const { queryOne, queryRun } = require('../db/database');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

let bot = null;

function getBot() {
  if (bot) return bot;
  if (!config.telegramBotToken) return null;

  try {
    const TelegramBot = require('node-telegram-bot-api');
    bot = new TelegramBot(config.telegramBotToken, { polling: true });
    
    // Обработчик команды /start
    bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const userName = msg.from.first_name + (msg.from.last_name ? ' ' + msg.from.last_name : '');
      
      const welcomeMsg = `👋 Здравствуйте, <b>${userName}</b>!\\n\\n` +
        `Я бот системы <b>Farovon C&B</b>.\\n\\n` +
        `Доступные команды:\\n` +
        `/getcreds — получить логин и временный пароль для входа\\n` +
        `/help — справка`;
      
      await sendTelegramMessage(chatId, welcomeMsg);
    });
    
    // Обработчик команды /getcreds
    bot.onText(/\/getcreds/, async (msg) => {
      const chatId = msg.chat.id;
      const userPhone = msg.from.phone || '';
      const userName = msg.from.first_name + (msg.from.last_name ? ' ' + msg.from.last_name : '');
      
      try {
        // Ищем пользователя по телефону или имени
        let user = null;
        if (userPhone) {
          user = await queryOne(
            "SELECT id, login, fio, role, phone, telegram_chat_id FROM users WHERE phone = ? AND active = 1 AND archived_at IS NULL",
            [userPhone]
          );
        }
        
        // Если не нашли по телефону, пробуем по имени (частичное совпадение)
        if (!user && userName) {
          const nameParts = userName.split(' ').filter(p => p.length > 2);
          for (const part of nameParts) {
            user = await queryOne(
              "SELECT id, login, fio, role, phone, telegram_chat_id FROM users WHERE fio LIKE ? AND active = 1 AND archived_at IS NULL",
              [`%${part}%`]
            );
            if (user) break;
          }
        }
        
        if (!user) {
          await sendTelegramMessage(
            chatId, 
            `❌ <b>Пользователь не найден.</b>\\n\\n` +
            `Возможно, ваш телефон не привязан к аккаунту или имя не совпадает.\\n` +
            `Обратитесь к администратору системы.`
          );
          return;
        }
        
        // Генерируем временный пароль
        const tempPassword = crypto.randomBytes(6).toString('base64').slice(0, 10);
        const hashedPassword = bcrypt.hashSync(tempPassword, 10);
        
        // Обновляем пароль в базе
        await queryRun(
          "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          [hashedPassword, user.id]
        );
        
        // Формируем сообщение с доступом
        const loginLink = `${config.webappUrl}/login`;
        const message = `✅ <b>Доступ получен!</b>\\n\\n` +
          `👤 <b>ФИО:</b> ${user.fio}\\n` +
          `🔑 <b>Логин:</b> <code>${user.login}</code>\\n` +
          `🔐 <b>Временный пароль:</b> <code>${tempPassword}</code>\\n\\n` +
          `⚠️ <b>Важно:</b> после первого входа обязательно смените пароль!\\n\\n` +
          `🔗 <b>Ссылка для входа:</b> ${loginLink}`;
        
        await sendTelegramMessage(chatId, message);
        
      } catch (err) {
        console.error('Error in /getcreds:', err);
        await sendTelegramMessage(
          chatId, 
          `❌ <b>Ошибка при получении данных.</b>\\n\\nПопробуйте позже или обратитесь к администратору.`
        );
      }
    });
    
    // Обработчик команды /help
    bot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id;
      const helpMsg = `ℹ️ <b>Справка по боту Farovon C&B</b>\\n\\n` +
        `<b>/start</b> — приветствие и список команд\\n` +
        `<b>/getcreds</b> — получить логин и временный пароль\\n` +
        `<b>/help</b> — эта справка\\n\\n` +
        `По вопросам обращайтесь к администратору системы.`;
      
      await sendTelegramMessage(chatId, helpMsg);
    });
    
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
