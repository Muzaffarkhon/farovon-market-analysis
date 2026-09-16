'use strict';

/**
 * Админка → «Чат поддержки»: переписка с гостями бота, которых он не смог
 * опознать (см. src/services/supportChatService.js и
 * src/controllers/telegramController.js — там кнопка «Написать
 * администратору» и приём сообщений).
 */

const { sendTelegramMessage } = require('../services/telegramService');
const supportChat = require('../services/supportChatService');
const { resetAndSendCredentials } = require('./telegramController');

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

    // Веб-тред — сотрудник читает ответ на сайте (баннер о новом сообщении),
    // в Telegram отправлять нечего: telegram_chat_id там синтетический.
    if (thread.source !== 'web') {
      const sent = await sendTelegramMessage(thread.telegram_chat_id, escHtml(text));
      if (!sent) return fail(res, 'Не удалось отправить сообщение в Telegram — возможно, человек заблокировал бота');
    }

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

    // Та же форма, что и у команды /login — не заставляем человека делать
    // лишний шаг: сразу шлём логин/временный пароль, а не «наберите /login».
    const sent = await resetAndSendCredentials(user, 'admin');
    if (!sent.ok) {
      // system_admin (пароль системного admin через бота не сбрасывается) и
      // send_failed (бот не смог написать, например заблокирован) — резервный
      // текст, чтобы человек хотя бы знал, что делать дальше.
      await sendTelegramMessage(
        thread.telegram_chat_id,
        `Готово, ${escHtml(user.fio)}! Telegram привязан администратором. Наберите /login, чтобы получить логин и пароль.`
      );
    }
    await supportChat.saveOutgoingMessage(id, `Привязано к сотруднику: ${user.fio}`, req.user.login);

    return res.json({ ok: true, message: `Привязано к ${user.fio}` });
  } catch (err) {
    if (err.message === 'Тред не найден' || err.message === 'Сотрудник не найден или неактивен') {
      return fail(res, err.message);
    }
    return handleError(res, err, 'supportLinkEmployee');
  }
}

function normalizeAudience(raw) {
  return raw === 'guest' ? 'guest' : 'admin';
}

/** Список готовых фраз — ?audience=admin (для C&B, по умолчанию) или
 *  ?audience=guest (клавиатура гостю в Telegram). */
async function listQuickReplies(req, res) {
  try {
    const audience = normalizeAudience(req.query && req.query.audience);
    const rows = await supportChat.listQuickReplies(audience);
    return res.json({ ok: true, rows });
  } catch (err) {
    return handleError(res, err, 'supportListQuickReplies');
  }
}

/** id в теле — правим существующую фразу, без id — добавляем новую в конец
 *  списка своей аудитории (audience учитывается только при добавлении). */
async function saveQuickReply(req, res) {
  try {
    const id = req.body && req.body.id ? parseInt(req.body.id, 10) : null;
    const text = String((req.body && req.body.text) || '').trim();
    const audience = normalizeAudience(req.body && req.body.audience);
    const answer = String((req.body && req.body.answer) || '').trim();
    if (!text) return fail(res, 'Введите текст фразы');
    if (text.length > 500) return fail(res, 'Слишком длинная фраза');
    if (answer.length > 2000) return fail(res, 'Слишком длинный ответ');

    const row = await supportChat.saveQuickReply(id, text, audience, audience === 'guest' ? answer : null);
    return res.json({ ok: true, id: row.id });
  } catch (err) {
    return handleError(res, err, 'supportSaveQuickReply');
  }
}

async function deleteQuickReply(req, res) {
  try {
    const id = parseInt(req.body && req.body.id, 10);
    if (!Number.isInteger(id)) return fail(res, 'Некорректная фраза');
    await supportChat.deleteQuickReply(id);
    return res.json({ ok: true });
  } catch (err) {
    return handleError(res, err, 'supportDeleteQuickReply');
  }
}

/** FAQ — админка (управление). Публичное чтение см. myServiceController.listFaq. */
async function saveFaq(req, res) {
  try {
    const id = req.body && req.body.id ? parseInt(req.body.id, 10) : null;
    const question = String((req.body && req.body.question) || '').trim();
    const answer = String((req.body && req.body.answer) || '').trim();
    if (!question) return fail(res, 'Введите вопрос');
    if (!answer) return fail(res, 'Введите ответ');
    if (question.length > 300) return fail(res, 'Слишком длинный вопрос');
    if (answer.length > 4000) return fail(res, 'Слишком длинный ответ');

    const row = await supportChat.saveFaq(id, question, answer);
    return res.json({ ok: true, id: row.id });
  } catch (err) {
    return handleError(res, err, 'supportSaveFaq');
  }
}

async function deleteFaq(req, res) {
  try {
    const id = parseInt(req.body && req.body.id, 10);
    if (!Number.isInteger(id)) return fail(res, 'Некорректный вопрос');
    await supportChat.deleteFaq(id);
    return res.json({ ok: true });
  } catch (err) {
    return handleError(res, err, 'supportDeleteFaq');
  }
}

module.exports = {
  listThreads, getThread, reply, close, unreadCount, linkEmployee,
  listQuickReplies, saveQuickReply, deleteQuickReply,
  saveFaq, deleteFaq
};
