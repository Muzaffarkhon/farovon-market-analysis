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

// Тред не хранит «кто это» отдельным полем — вместо этого смотрим, кому
// СЕЙЧАС принадлежит этот telegram_chat_id среди активных пользователей.
// Так работает не только сразу после «Привязать к сотруднику», но и если
// человека узнали раньше через /start или по номеру в самом боте — тред
// всё равно покажет реальное имя, а не «Гость #N».
// web-тред — сотрудник уже вошёл в систему, имя берём напрямую по user_id;
// telegram-тред — по текущему владельцу этого telegram_chat_id (см. коммент
// у linkEmployee ниже — так работает даже без ручной привязки).
const LINKED_FIO_JOIN = `
  LEFT JOIN users lu ON
    (t.source = 'web' AND lu.id = t.user_id)
    OR (t.source != 'web' AND lu.telegram_chat_id = t.telegram_chat_id AND lu.archived_at IS NULL AND lu.active = 1)
`;

/**
 * Список тредов для админки — сначала с непрочитанным, затем по свежести.
 * Поиск/фильтры — тот же приём, что и у renderSupLinkResults на клиенте
 * (см. client/app.js): фильтруем в JS после выборки, а не через SQL LIKE.
 * Это не обход — SQLite LIKE/LOWER регистронезависимы только для ASCII,
 * с кириллицей (имена, темы) просто не сработают; тредов немного, лишний
 * SELECT дешевле, чем городить кастомную коллацию в Turso.
 *
 * filters: { q, status, reply:'pending', login:'missing', unread:'yes' }
 */
async function listThreads(filters) {
  filters = filters || {};
  let rows = await queryAll(`
    SELECT t.id, t.telegram_chat_id, t.phone, t.status, t.source, t.topic, t.archived_at,
      t.last_message_at, t.created_at,
      lu.fio AS linked_fio,
      (SELECT body FROM support_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
      (SELECT direction FROM support_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_direction,
      (SELECT COUNT(*) FROM support_messages m WHERE m.thread_id = t.id AND m.direction = 'in' AND m.read_at IS NULL) AS unread_count
    FROM support_threads t
    ${LINKED_FIO_JOIN}
    ORDER BY (unread_count > 0) DESC, t.last_message_at DESC
  `);

  // По умолчанию архивные не мешают рабочему списку; filters.archived='yes' —
  // отдельный просмотр самого архива (кнопка «Архив» в админке).
  rows = filters.archived === 'yes' ? rows.filter(r => r.archived_at) : rows.filter(r => !r.archived_at);

  const q = String(filters.q || '').trim();
  if (q) {
    const qLower = q.toLowerCase();
    // Поиск «по переписке» — не только по тому, что видно в строке списка
    // (имя/телефон/тема), но и по тексту сообщений. Сообщений немного —
    // проще выбрать все разом и отфильтровать в JS.
    const allMsgs = await queryAll('SELECT thread_id, body FROM support_messages');
    const matchedInMsgs = new Set();
    allMsgs.forEach(m => { if (String(m.body || '').toLowerCase().includes(qLower)) matchedInMsgs.add(m.thread_id); });

    rows = rows.filter(r => {
      const inVisible =
        String(r.linked_fio || '').toLowerCase().includes(qLower) ||
        String(r.phone || '').toLowerCase().includes(qLower) ||
        String(r.topic || '').toLowerCase().includes(qLower);
      const inMsgs = matchedInMsgs.has(r.id);
      if (!inVisible && !inMsgs) return false;
      r.matched_in_message_only = !inVisible && inMsgs;
      return true;
    });
  }

  if (filters.status === 'open' || filters.status === 'closed') {
    rows = rows.filter(r => r.status === filters.status);
  }
  if (filters.reply === 'pending') rows = rows.filter(r => r.last_direction === 'in');
  // «Нет привязки» имеет смысл только для гостя Telegram-бота — у веб-треда
  // личность известна с самого начала (см. коммент у LINKED_FIO_JOIN).
  if (filters.login === 'missing') rows = rows.filter(r => r.source !== 'web' && !r.linked_fio);
  if (filters.unread === 'yes') rows = rows.filter(r => r.unread_count > 0);

  return rows;
}

async function countUnreadThreads() {
  const row = await queryOne(`
    SELECT COUNT(DISTINCT thread_id) AS n FROM support_messages WHERE direction = 'in' AND read_at IS NULL
  `);
  return (row && row.n) || 0;
}

async function getThread(threadId) {
  return queryOne(`
    SELECT t.*, lu.fio AS linked_fio
    FROM support_threads t
    ${LINKED_FIO_JOIN}
    WHERE t.id = ?
  `, [threadId]);
}

async function getMessages(threadId) {
  return queryAll(
    'SELECT * FROM support_messages WHERE thread_id = ? ORDER BY created_at ASC',
    [threadId]
  );
}

/** Пометить входящие сообщения треда прочитанными — и при ответе C&B, и
 *  просто при открытии треда в админке (см. markThreadRead ниже): счётчик
 *  непрочитанного не должен требовать обязательного ответа, чтобы уйти. */
async function markThreadRead(threadId) {
  await run(
    `UPDATE support_messages SET read_at = CURRENT_TIMESTAMP
     WHERE thread_id = ? AND direction = 'in' AND read_at IS NULL`,
    [threadId]
  );
}

/** Ответ C&B — отправка в Telegram делает вызывающий контроллер, здесь только запись. */
async function saveOutgoingMessage(threadId, body, authorLogin) {
  await run(
    'INSERT INTO support_messages (thread_id, direction, body, author_login) VALUES (?, \'out\', ?, ?)',
    [threadId, body, authorLogin]
  );
  await markThreadRead(threadId);
  await run('UPDATE support_threads SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?', [threadId]);
}

/** Без подтверждения — не разрушительно, тред просто переоткроется, если гость напишет снова. */
async function closeThread(threadId) {
  await run('UPDATE support_threads SET status = \'closed\' WHERE id = ?', [threadId]);
}

/** Скрыть из рабочего списка, не удаляя — обратимо, см. unarchiveThread. */
async function archiveThread(threadId) {
  await run('UPDATE support_threads SET archived_at = CURRENT_TIMESTAMP WHERE id = ?', [threadId]);
}

async function unarchiveThread(threadId) {
  await run('UPDATE support_threads SET archived_at = NULL WHERE id = ?', [threadId]);
}

/** Необратимо: стирает тред и всю переписку. Только для админа (см. контроллер). */
async function deleteThread(threadId) {
  await run('DELETE FROM support_messages WHERE thread_id = ?', [threadId]);
  await run('DELETE FROM support_threads WHERE id = ?', [threadId]);
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
    'SELECT id, login, fio FROM users WHERE id = ? AND archived_at IS NULL AND active = 1',
    [userId]
  );
  if (!user) throw new Error('Сотрудник не найден или неактивен');

  const chatId = thread.telegram_chat_id;
  const newPhone = phone || thread.phone || '';
  await run('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = ? AND id != ?', [chatId, userId]);
  // Номер трогаем, только если он реально известен (из треда или передан явно) —
  // если гость просто писал текстом без «Отправить номер телефона», номера
  // может не быть вообще, и обнулять то, что уже стояло в карточке, нельзя.
  if (newPhone) {
    await run(
      `UPDATE users SET telegram_chat_id = ?, phone = ?, telegram_link_token = NULL, telegram_link_expires = NULL
       WHERE id = ?`,
      [chatId, newPhone, userId]
    );
  } else {
    await run(
      `UPDATE users SET telegram_chat_id = ?, telegram_link_token = NULL, telegram_link_expires = NULL
       WHERE id = ?`,
      [chatId, userId]
    );
  }

  user.telegram_chat_id = chatId;
  return user;
}

/** Готовые фразы одной кнопкой — 'admin' (вставляются в поле ответа C&B) или
 *  'guest' (клавиатура гостю в Telegram). Редактируются из самой админки,
 *  не хардкод в коде. */
async function listQuickReplies(audience) {
  return queryAll(
    'SELECT id, text, answer FROM support_quick_replies WHERE audience = ? ORDER BY sort_order ASC, id ASC',
    [audience || 'admin']
  );
}

/** id есть — правим текст (и для guest — ответ) существующей фразы, нет —
 *  добавляем новую в конец списка своей аудитории. answer имеет смысл только
 *  для audience='guest' (готовый ответ для кнопки «Частые вопросы» в боте). */
async function saveQuickReply(id, text, audience, answer) {
  if (id) {
    await run('UPDATE support_quick_replies SET text = ?, answer = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [text, answer || null, id]);
    return { id };
  }
  const aud = audience || 'admin';
  const row = await queryOne('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM support_quick_replies WHERE audience = ?', [aud]);
  const res = await run('INSERT INTO support_quick_replies (text, answer, audience, sort_order) VALUES (?, ?, ?, ?)', [text, answer || null, aud, row.next]);
  return { id: Number(res.lastInsertRowid || res.insertId || 0) };
}

async function deleteQuickReply(id) {
  await run('DELETE FROM support_quick_replies WHERE id = ?', [id]);
}

// ─── Веб-канал: сотрудник пишет прямо на сайте (не через Telegram-бота) ───
// Личность уже известна (вошёл в систему), поэтому в отличие от гостя бота
// никого привязывать не нужно — тред сразу принадлежит user_id.

/** Один тред на одну тему — новая тема всегда новый тред, старые не переиспользуются. */
async function createWebThread(userId, topic, text) {
  const chatId = 'web-' + userId + '-' + Date.now();
  const res = await run(
    "INSERT INTO support_threads (telegram_chat_id, status, source, user_id, topic) VALUES (?, 'open', 'web', ?, ?)",
    [chatId, userId, topic || null]
  );
  const threadId = Number(res.lastInsertRowid || res.insertId || 0);
  await run("INSERT INTO support_messages (thread_id, direction, body) VALUES (?, 'in', ?)", [threadId, text]);
  return threadId;
}

/** Свои обращения сотрудника — только source='web' и только его собственные (user_id). */
async function listMyThreads(userId) {
  return queryAll(`
    SELECT t.id, t.topic, t.status, t.last_message_at, t.created_at,
      (SELECT body FROM support_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
      (SELECT direction FROM support_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_direction,
      (SELECT COUNT(*) FROM support_messages m WHERE m.thread_id = t.id AND m.direction = 'out' AND m.read_at_user IS NULL) AS unread_count
    FROM support_threads t
    WHERE t.user_id = ? AND t.source = 'web'
    ORDER BY t.last_message_at DESC
  `, [userId]);
}

/** Принадлежность треда проверяется тут же (WHERE user_id) — не отдельным
 *  запросом, чтобы нельзя было подсмотреть чужой тред, подставив id в URL. */
async function getMyThread(userId, threadId) {
  const thread = await queryOne("SELECT * FROM support_threads WHERE id = ? AND user_id = ? AND source = 'web'", [threadId, userId]);
  if (!thread) return null;
  const messages = await queryAll('SELECT * FROM support_messages WHERE thread_id = ? ORDER BY created_at ASC', [threadId]);
  await run("UPDATE support_messages SET read_at_user = CURRENT_TIMESTAMP WHERE thread_id = ? AND direction = 'out' AND read_at_user IS NULL", [threadId]);
  return { thread, messages };
}

/** Сотрудник дописывает в свой уже открытый тред (переоткрывает закрытый). */
async function saveOwnMessage(userId, threadId, text) {
  const thread = await queryOne("SELECT id FROM support_threads WHERE id = ? AND user_id = ? AND source = 'web'", [threadId, userId]);
  if (!thread) throw new Error('Тред не найден');
  await run("INSERT INTO support_messages (thread_id, direction, body) VALUES (?, 'in', ?)", [threadId, text]);
  await run("UPDATE support_threads SET last_message_at = CURRENT_TIMESTAMP, status = 'open' WHERE id = ?", [threadId]);
}

/** Для баннера «есть новый ответ поддержки» — считает по всем своим тредам разом. */
async function countMyUnread(userId) {
  const row = await queryOne(`
    SELECT COUNT(*) AS n FROM support_messages m
    JOIN support_threads t ON t.id = m.thread_id
    WHERE t.user_id = ? AND t.source = 'web' AND m.direction = 'out' AND m.read_at_user IS NULL
  `, [userId]);
  return (row && row.n) || 0;
}

// ─── FAQ: вопрос-ответ, которым управляет администратор ───

async function listFaq() {
  return queryAll('SELECT id, question, answer FROM support_faq ORDER BY sort_order ASC, id ASC');
}

async function saveFaq(id, question, answer) {
  if (id) {
    await run('UPDATE support_faq SET question = ?, answer = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [question, answer, id]);
    return { id };
  }
  const row = await queryOne('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM support_faq');
  const res = await run('INSERT INTO support_faq (question, answer, sort_order) VALUES (?, ?, ?)', [question, answer, row.next]);
  return { id: Number(res.lastInsertRowid || res.insertId || 0) };
}

async function deleteFaq(id) {
  await run('DELETE FROM support_faq WHERE id = ?', [id]);
}

module.exports = {
  getOrCreateThread, findThreadByChatId, saveIncomingMessage,
  listThreads, countUnreadThreads, getThread, getMessages,
  saveOutgoingMessage, closeThread, archiveThread, unarchiveThread, deleteThread, linkEmployee, markThreadRead,
  listQuickReplies, saveQuickReply, deleteQuickReply,
  createWebThread, listMyThreads, getMyThread, saveOwnMessage, countMyUnread,
  listFaq, saveFaq, deleteFaq
};
