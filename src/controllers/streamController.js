'use strict';

const { queryOne } = require('../db/database');
const { hasCapability } = require('../middleware/auth');

/**
 * Живое обновление разделов (дашборд, админка: периоды/гранты/пользователи)
 * без внешней инфраструктуры (нет WebSocket-сервера, нет Redis) — тот же
 * приём, что в соседнем проекте (faravon-cafeteria/src/app/api/stream):
 * соединение короткоживущее, EventSource на фронте переподключается сам
 * (см. public/liveRefresh.js). Пока соединение живо, сервер каждые POLL_MS
 * сверяет компактную «подпись» релевантных пользователю данных и шлёт
 * событие `update`, только если она реально изменилась.
 */
const POLL_MS = 8000;
const MAX_LIFETIME_MS = 25000;

// Мягкий лимit одновременных соединений на пользователя — защита от «открыл
// 10 вкладок» → 10×N SQL-агрегатов каждые POLL_MS. EventSource переподключается
// сам, поэтому кратковременный отказ (429) безвреден.
const MAX_CONN_PER_USER = 6;
const liveConns = new Map();

/** Компактный слепок того, что могло измениться и важно ИМЕННО этому
 *  пользователю — считаем только те части, на которые у него есть право,
 *  чтобы не гонять лишние запросы и не слать update на данные, которые он
 *  всё равно не увидит. */
async function signatureFor(user) {
  const parts = [];

  if (await hasCapability(user, 'dashboard:view')) {
    const row = await queryOne(`
      SELECT
        (SELECT id || ':' || state FROM periods WHERE is_active = 1 LIMIT 1) AS period,
        (SELECT COUNT(*) FROM surveys WHERE state != 'удалена') AS "survCount",
        (SELECT MAX(created_at) FROM surveys WHERE state != 'удалена') AS "survMax",
        (SELECT COUNT(*) FROM competitors) AS "compCount",
        (SELECT MAX(updated_at) FROM competitors) AS "compMax"
    `);
    parts.push('dash:' + JSON.stringify(row));
  }

  if (await hasCapability(user, 'period:edit')) {
    const row = await queryOne(`
      SELECT
        (SELECT COUNT(*) FROM periods) AS "periodCount",
        (SELECT id || ':' || state FROM periods WHERE is_active = 1 LIMIT 1) AS "activePeriod",
        (SELECT COUNT(*) FROM period_edit_grants WHERE expires_at > CURRENT_TIMESTAMP) AS "grantCount",
        (SELECT MAX(granted_at) FROM period_edit_grants) AS "grantMax"
    `);
    parts.push('period:' + JSON.stringify(row));
  }

  if (await hasCapability(user, 'users:view')) {
    const row = await queryOne(`
      SELECT COUNT(*) AS n, MAX(updated_at) AS mx FROM users WHERE archived_at IS NULL
    `);
    parts.push('users:' + JSON.stringify(row));
  }

  return parts.join('|');
}

exports.stream = async (req, res) => {
  const uid = req.user.login;
  const n = liveConns.get(uid) || 0;
  if (n >= MAX_CONN_PER_USER) {
    return res.status(429).json({ ok: false, error: 'Слишком много открытых соединений' });
  }
  liveConns.set(uid, n + 1);

  let closed = false;
  const release = () => {
    if (closed) return;
    closed = true;
    const cur = (liveConns.get(uid) || 1) - 1;
    if (cur <= 0) liveConns.delete(uid); else liveConns.set(uid, cur);
  };

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  // Подсказка браузеру: переподключаться через 3с после разрыва.
  res.write('retry: 3000\n\n');
  res.write('event: hello\ndata: ' + JSON.stringify({ t: Date.now() }) + '\n\n');

  // null — базовая подпись ещё не получена; первый удачный опрос принимаем
  // за базу и НЕ шлём update, иначе холодный старт всегда выглядел бы как
  // изменение.
  let last = null;
  try { last = await signatureFor(req.user); } catch (e) { /* сверимся на следующем тике */ }

  const startedAt = Date.now();
  const timer = setInterval(async () => {
    if (closed) return;
    if (Date.now() - startedAt > MAX_LIFETIME_MS) {
      res.write('event: bye\ndata: {}\n\n');
      clearInterval(timer);
      release();
      res.end();
      return;
    }
    try {
      const now = await signatureFor(req.user);
      if (last === null) {
        last = now;
        res.write(': base\n\n');
      } else if (now !== last) {
        last = now;
        res.write('event: update\ndata: ' + JSON.stringify({ t: Date.now() }) + '\n\n');
      } else {
        res.write(': ping\n\n'); // heartbeat — не даём прокси закрыть соединение
      }
    } catch (e) {
      res.write(': err\n\n');
    }
  }, POLL_MS);

  req.on('close', () => {
    clearInterval(timer);
    release();
  });
};
