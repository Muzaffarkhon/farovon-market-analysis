'use strict';

/**
 * Чат поддержки: тред на один Telegram-чат, переоткрывается при новом
 * сообщении, а не плодится заново. Решает проблему «бот не опознал человека
 * и на этом всё» — теперь есть кнопка «Написать администратору», после
 * которой переписка идёт здесь же, C&B отвечает из системы.
 *
 * Перенесено (с адаптацией под Express/Turso вместо Next.js/Prisma) из
 * проекта «Фаровон Кафетерий» — там та же проблема с ботом уже решена.
 */

const { queryAll, queryOne, run } = require('../db/database');

/**
 * Найти открытый/закрытый тред по chat_id, переоткрыть закрытый.
 * Возвращает { id, opened } — opened=true только когда тред только что
 * создан или переоткрыт из «closed» (именно в этот момент нужно уведомлять
 * C&B), false — если он и так уже был открыт.
 */
async function getOrCreateThread(telegramChatId, phone) {
  const chatId = String(telegramChatId);
  const existing = await queryOne('SELECT * FROM support_threads WHERE telegram_chat_id = ?', [chatId]);

  if (!existing) {
    const res = await run(
      'INSERT INTO support_threads (telegram_chat_id, phone, status) VALUES (?, ?, ?)',
      [chatId, phone || null, 'open']
    );
    return { id: Number(res.lastInsertRowid || res.insertId || 0), opened: true };
  }

  const wasClosed = existing.status === 'closed';
  // Переоткрываем закрытый, обновляем телефон, если раньше его не знали, а
  // сейчас человек поделился контактом — подсказка C&B, кто это.
  const sets = ['status = \'open\'', 'last_message_at = CURRENT_TIMESTAMP'];
  const args = [];
  if (phone && !existing.phone) { sets.push('phone = ?'); args.push(phone); }
  args.push(existing.id);
  await run(`UPDATE support_threads SET ${sets.join(', ')} WHERE id = ?`, args);
  return { id: existing.id, opened: wasClosed };
}

/** Есть ли для этого чата уже тред (открытый или закрытый) — не создаёт новый. */
async function findThreadByChatId(telegramChatId) {
  return queryOne('SELECT * FROM support_threads WHERE telegram_chat_id = ?', [String(telegramChatId)]);
}

/**
 * Сохраняет входящее сообщение. Уведомление C&B решается не здесь, а в
 * getOrCreateThread (см. флаг opened) — ровно в момент, когда тред
 * создаётся или переоткрывается, а не на каждое сообщение подряд.
 */
async function saveIncomingMessage(threadId, body) {
  await run(
    'INSERT INTO support_messages (thread_id, direction, body) VALUES (?, \'in\', ?)',
    [threadId, body]
  );
  await run('UPDATE support_threads SET last_message_at = CURRENT_TIMESTAMP, status = \'open\' WHERE id = ?', [threadId]);
}

/** Список тредов для админки — сначала с непрочитанным, затем по свежести. */
async function listThreads() {
  return queryAll(`
    SELECT t.id, t.telegram_chat_id, t.phone, t.status, t.last_message_at, t.created_at,
      (SELECT body FROM support_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
      (SELECT direction FROM support_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_direction,
      (SELECT COUNT(*) FROM support_messages m WHERE m.thread_id = t.id AND m.direction = 'in' AND m.read_at IS NULL) AS unread_count
    FROM support_threads t
    ORDER BY (unread_count > 0) DESC, t.last_message_at DESC
  `);
}

async function countUnreadThreads() {
  const row = await queryOne(`
    SELECT COUNT(DISTINCT thread_id) AS n FROM support_messages WHERE direction = 'in' AND read_at IS NULL
  `);
  return (row && row.n) || 0;
}

async function getThread(threadId) {
  return queryOne('SELECT * FROM support_threads WHERE id = ?', [threadId]);
}

async function getMessages(threadId) {
  return queryAll(
    'SELECT * FROM support_messages WHERE thread_id = ? ORDER BY created_at ASC',
    [threadId]
  );
}

/** Ответ C&B — отправка в Telegram делает вызывающий контроллер, здесь только запись. */
async function saveOutgoingMessage(threadId, body, authorLogin) {
  await run(
    'INSERT INTO support_messages (thread_id, direction, body, author_login) VALUES (?, \'out\', ?, ?)',
    [threadId, body, authorLogin]
  );
  await run(
    `UPDATE support_messages SET read_at = CURRENT_TIMESTAMP
     WHERE thread_id = ? AND direction = 'in' AND read_at IS NULL`,
    [threadId]
  );
  await run('UPDATE support_threads SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?', [threadId]);
}

/** Без подтверждения — не разрушительно, тред просто переоткроется, если гость напишет снова. */
async function closeThread(threadId) {
  await run('UPDATE support_threads SET status = \'closed\' WHERE id = ?', [threadId]);
}

/**
 * Главный сценарий, ради которого нужен чат поддержки: гость не опознан по
 * номеру (см. handleContact в telegramController), C&B находит его тут по
 * ФИО и привязывает — карточка получает актуальный номер и telegram_chat_id,
 * человек сразу может получить логин через /login.
 *
 * telegram_chat_id снимаем с прежнего владельца (если был), чтобы один
 * Telegram-чат не оказался привязан сразу к двум сотрудникам.
 */
async function linkEmployee(threadId, userId, phone) {
  const thread = await getThread(threadId);
  if (!thread) throw new Error('Тред не найден');

  const user = await queryOne(
    'SELECT id, fio FROM users WHERE id = ? AND archived_at IS NULL AND active = 1',
    [userId]
  );
  if (!user) throw new Error('Сотрудник не найден или неактивен');

  const chatId = thread.telegram_chat_id;
  await run('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = ? AND id != ?', [chatId, userId]);
  await run(
    `UPDATE users SET telegram_chat_id = ?, phone = ?, telegram_link_token = NULL, telegram_link_expires = NULL
     WHERE id = ?`,
    [chatId, phone || thread.phone || null, userId]
  );

  return user;
}

module.exports = {
  getOrCreateThread, findThreadByChatId, saveIncomingMessage,
  listThreads, countUnreadThreads, getThread, getMessages,
  saveOutgoingMessage, closeThread, linkEmployee
};
