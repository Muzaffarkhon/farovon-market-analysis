'use strict';

/**
 * «Поддержка» глазами самого сотрудника: написать напрямую на сайте (не
 * через Telegram-бота), увидеть свои обращения и ответы, посмотреть FAQ.
 * Доступно любому вошедшему в систему пользователю — своя переписка, а не
 * админский инбокс (см. supportController.js — там то же самое для C&B).
 *
 * Перенесено (с адаптацией под Express/Turso) из проекта «Фаровон Кафетерий».
 */

const supportChat = require('../services/supportChatService');

function fail(res, message, status = 400) {
  return res.status(status).json({ ok: false, error: message, message });
}

function handleError(res, err, where) {
  console.error(`${where} error:`, err.message);
  return fail(res, 'Не удалось выполнить операцию, попробуйте ещё раз', 500);
}

async function myThreads(req, res) {
  try {
    const rows = await supportChat.listMyThreads(req.user.id);
    return res.json({ ok: true, rows });
  } catch (err) {
    return handleError(res, err, 'myThreads');
  }
}

async function myThread(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return fail(res, 'Некорректное обращение');

    const found = await supportChat.getMyThread(req.user.id, id);
    if (!found) return fail(res, 'Обращение не найдено', 404);

    return res.json({ ok: true, thread: found.thread, messages: found.messages });
  } catch (err) {
    return handleError(res, err, 'myThread');
  }
}

const TOPIC_MAX = 100;
const TEXT_MAX = 2000;

async function myStart(req, res) {
  try {
    const topic = String((req.body && req.body.topic) || '').trim();
    const text = String((req.body && req.body.text) || '').trim();
    if (!topic) return fail(res, 'Выберите тему обращения');
    if (topic.length > TOPIC_MAX) return fail(res, 'Слишком длинная тема');
    if (!text) return fail(res, 'Опишите вопрос');
    if (text.length > TEXT_MAX) return fail(res, 'Слишком длинное сообщение');

    const id = await supportChat.createWebThread(req.user.id, topic, text);
    return res.json({ ok: true, id });
  } catch (err) {
    return handleError(res, err, 'myStart');
  }
}

async function myReply(req, res) {
  try {
    const id = parseInt(req.body && req.body.thread_id, 10);
    const text = String((req.body && req.body.text) || '').trim();
    if (!Number.isInteger(id)) return fail(res, 'Некорректное обращение');
    if (!text) return fail(res, 'Введите текст сообщения');
    if (text.length > TEXT_MAX) return fail(res, 'Слишком длинное сообщение');

    await supportChat.saveOwnMessage(req.user.id, id, text);
    return res.json({ ok: true });
  } catch (err) {
    if (err.message === 'Тред не найден') return fail(res, err.message, 404);
    return handleError(res, err, 'myReply');
  }
}

async function myUnreadCount(req, res) {
  try {
    const n = await supportChat.countMyUnread(req.user.id);
    return res.json({ ok: true, count: n });
  } catch (err) {
    return handleError(res, err, 'myUnreadCount');
  }
}

async function faqList(req, res) {
  try {
    const rows = await supportChat.listFaq();
    return res.json({ ok: true, rows });
  } catch (err) {
    return handleError(res, err, 'faqList');
  }
}

module.exports = { myThreads, myThread, myStart, myReply, myUnreadCount, faqList };
