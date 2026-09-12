'use strict';

/**
 * Админка → «Чат поддержки»: переписка с гостями бота, которых он не смог
 * опознать (см. src/services/supportChatService.js и
 * src/controllers/telegramController.js — там кнопка «Написать
 * администратору» и приём сообщений).
 */

const { sendTelegramMessage } = require('../services/telegramService');
const supportChat = require('../services/supportChatService');

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fail(res, message, status = 400) {
  return res.status(status).json({ ok: false, error: message, message });
}

function handleError(res, err, where) {
  console.error(`${where} error:`, err.message);
  return fail(res, 'Не удалось выполнить операцию, попробуйте ещё раз', 500);
}

async function listThreads(req, res) {
  try {
    const rows = await supportChat.listThreads();
    return res.json({ ok: true, rows });
  } catch (err) {
    return handleError(res, err, 'supportListThreads');
  }
}

async function getThread(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return fail(res, 'Некорректный тред');

    const thread = await supportChat.getThread(id);
    if (!thread) return fail(res, 'Тред не найден', 404);

    // Открыл тред — уже прочитал. Раньше это происходило только при ответе,
    // и счётчик непрочитанного висел, даже если C&B всё видел, просто нечего
    // было ответить (например, сообщение было чисто информационным).
    await supportChat.markThreadRead(id);

    const messages = await supportChat.getMessages(id);
    return res.json({ ok: true, thread, messages });
  } catch (err) {
    return handleError(res, err, 'supportGetThread');
  }
}

async function reply(req, res) {
  try {
    const id = parseInt(req.body && req.body.thread_id, 10);
    const text = String((req.body && req.body.text) || '').trim();
    if (!Number.isInteger(id)) return fail(res, 'Некорректный тред');
    if (!text) return fail(res, 'Введите текст ответа');

    const thread = await supportChat.getThread(id);
    if (!thread) return fail(res, 'Тред не найден', 404);

    const sent = await sendTelegramMessage(thread.telegram_chat_id, escHtml(text));
    if (!sent) return fail(res, 'Не удалось отправить сообщение в Telegram — возможно, человек заблокировал бота');

    await supportChat.saveOutgoingMessage(id, text, req.user.login);
    return res.json({ ok: true, message: 'Отправлено' });
  } catch (err) {
    return handleError(res, err, 'supportReply');
  }
}

async function close(req, res) {
  try {
    const id = parseInt(req.body && req.body.thread_id, 10);
    if (!Number.isInteger(id)) return fail(res, 'Некорректный тред');

    const thread = await supportChat.getThread(id);
    if (!thread) return fail(res, 'Тред не найден', 404);

    await supportChat.closeThread(id);
    return res.json({ ok: true, message: 'Диалог закрыт' });
  } catch (err) {
    return handleError(res, err, 'supportClose');
  }
}

async function unreadCount(req, res) {
  try {
    const n = await supportChat.countUnreadThreads();
    return res.json({ ok: true, count: n });
  } catch (err) {
    return handleError(res, err, 'supportUnreadCount');
  }
}

/** Привязка гостя чата к карточке сотрудника — см. supportChatService.linkEmployee. */
async function linkEmployee(req, res) {
  try {
    const id = parseInt(req.body && req.body.thread_id, 10);
    const userId = parseInt(req.body && req.body.user_id, 10);
    if (!Number.isInteger(id)) return fail(res, 'Некорректный тред');
    if (!Number.isInteger(userId)) return fail(res, 'Выберите сотрудника');

    const thread = await supportChat.getThread(id);
    if (!thread) return fail(res, 'Тред не найден', 404);

    const user = await supportChat.linkEmployee(id, userId, thread.phone);

    await sendTelegramMessage(
      thread.telegram_chat_id,
      `Готово, ${escHtml(user.fio)}! Telegram привязан администратором. Наберите /login, чтобы получить логин и пароль.`
    );
    await supportChat.saveOutgoingMessage(id, `Привязано к сотруднику: ${user.fio}`, req.user.login);

    return res.json({ ok: true, message: `Привязано к ${user.fio}` });
  } catch (err) {
    if (err.message === 'Тред не найден' || err.message === 'Сотрудник не найден или неактивен') {
      return fail(res, err.message);
    }
    return handleError(res, err, 'supportLinkEmployee');
  }
}

module.exports = { listThreads, getThread, reply, close, unreadCount, linkEmployee };
