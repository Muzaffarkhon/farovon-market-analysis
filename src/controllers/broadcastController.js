'use strict';

/**
 * Админка → «Рассылка»: массовое сообщение сотрудникам через Telegram-бота.
 * Получателей выбирает интерфейс (все привязанные / по ролям и
 * подразделениям / вручную), сюда приходит готовый список id — сервер сам
 * перепроверяет, что каждый активен и привязан, и шлёт только им.
 */

const config = require('../config');
const { queryAll, queryOne, run } = require('../db/database');
const { sendTelegramMessage } = require('../services/telegramService');

const MAX_BODY = 3500;   // лимит Telegram — 4096, запас под подпись
const MAX_RECIPIENTS = 1000;
const BATCH = 10;        // параллельных отправок; Telegram допускает ~30 сообщений/с

function fail(res, message, status = 400) {
  return res.status(status).json({ ok: false, error: message, message });
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Все, кому рассылка вообще может дойти: активные, не в архиве, с привязанным Telegram. */
async function recipients(req, res) {
  try {
    const rows = await queryAll(
      `SELECT id, login, fio, role, units FROM users
       WHERE active = 1 AND archived_at IS NULL AND role <> 'admin' AND TRIM(COALESCE(telegram_chat_id,'')) <> ''
       ORDER BY fio`);
    const total = await queryOne(
      "SELECT COUNT(*) AS n FROM users WHERE active = 1 AND archived_at IS NULL AND role <> 'admin'");
    return res.json({ ok: true, rows, totalActive: total ? Number(total.n) : 0 });
  } catch (err) {
    console.error('broadcastRecipients error:', err.message);
    return fail(res, 'Не удалось загрузить получателей', 500);
  }
}

async function list(req, res) {
  try {
    const rows = await queryAll(
      'SELECT id, author_login, body, with_button, total, sent, failed, created_at FROM broadcasts ORDER BY id DESC LIMIT 100');
    return res.json({ ok: true, rows });
  } catch (err) {
    console.error('broadcastList error:', err.message);
    return fail(res, 'Не удалось загрузить историю', 500);
  }
}

async function details(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return fail(res, 'Некорректная рассылка');
    const broadcast = await queryOne('SELECT * FROM broadcasts WHERE id = ?', [id]);
    if (!broadcast) return fail(res, 'Рассылка не найдена', 404);
    const rows = await queryAll(
      'SELECT fio, status, sent_at FROM broadcast_recipients WHERE broadcast_id = ? ORDER BY status DESC, fio', [id]);
    return res.json({ ok: true, broadcast, recipients: rows });
  } catch (err) {
    console.error('broadcastDetails error:', err.message);
    return fail(res, 'Не удалось загрузить рассылку', 500);
  }
}

async function send(req, res) {
  try {
    const body = String((req.body && req.body.body) || '').trim();
    const withButton = !!(req.body && req.body.withButton);
    const ids = Array.isArray(req.body && req.body.userIds)
      ? [...new Set(req.body.userIds.map(n => parseInt(n, 10)).filter(Number.isInteger))]
      : [];

    if (!config.telegramBotToken) {
      return fail(res, 'Telegram-бот не подключён на этом сервере (не задан TELEGRAM_BOT_TOKEN) — рассылка невозможна');
    }
    if (!body) return fail(res, 'Введите текст рассылки');
    if (body.length > MAX_BODY) return fail(res, `Текст слишком длинный (максимум ${MAX_BODY} символов)`);
    if (!ids.length) return fail(res, 'Выберите хотя бы одного получателя');
    if (ids.length > MAX_RECIPIENTS) return fail(res, `Слишком много получателей (максимум ${MAX_RECIPIENTS})`);

    const placeholders = ids.map(() => '?').join(',');
    const users = await queryAll(
      `SELECT id, fio, telegram_chat_id FROM users
       WHERE id IN (${placeholders}) AND active = 1 AND archived_at IS NULL AND role <> 'admin'
         AND TRIM(COALESCE(telegram_chat_id,'')) <> ''`, ids);
    if (!users.length) return fail(res, 'Ни у одного из выбранных нет привязанного Telegram');

    const author = (req.user && req.user.login) || 'unknown';
    const ins = await run(
      'INSERT INTO broadcasts (author_login, body, with_button, total) VALUES (?, ?, ?, ?)',
      [author, body, withButton ? 1 : 0, users.length]);
    const broadcastId = Number(ins.lastInsertRowid || ins.insertId || 0);

    const platformUrl = config.webappUrl;
    // Telegram отклоняет сообщение целиком, если адрес кнопки не https
    // (локальный http://localhost) — тогда шлём без кнопки, а не теряем рассылку.
    const options = { parse_mode: 'HTML' };
    if (withButton && /^https:\/\//i.test(platformUrl)) {
      options.reply_markup = {
        inline_keyboard: [[{ text: '🚀 Открыть «Обзор рынка»', web_app: { url: platformUrl } }]]
      };
    }
    const text = `📢 ${escHtml(body)}`;

    let sent = 0;
    let failed = 0;
    for (let i = 0; i < users.length; i += BATCH) {
      const chunk = users.slice(i, i + BATCH);
      const results = await Promise.all(chunk.map(u => sendTelegramMessage(u.telegram_chat_id, text, options)));
      for (let j = 0; j < chunk.length; j++) {
        const ok = results[j];
        if (ok) sent++; else failed++;
        await run(
          `INSERT INTO broadcast_recipients (broadcast_id, user_id, fio, telegram_chat_id, status, sent_at)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [broadcastId, chunk[j].id, chunk[j].fio, String(chunk[j].telegram_chat_id), ok ? 'sent' : 'failed']);
      }
    }

    await run('UPDATE broadcasts SET sent = ?, failed = ? WHERE id = ?', [sent, failed, broadcastId]);
    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      author, 'рассылка',
      `Рассылка #${broadcastId}: доставлено ${sent} из ${users.length}`
    ]);

    return res.json({ ok: true, id: broadcastId, total: users.length, sent, failed });
  } catch (err) {
    console.error('broadcastSend error:', err.message);
    return fail(res, 'Не удалось отправить рассылку, попробуйте ещё раз', 500);
  }
}

module.exports = { recipients, list, details, send };
