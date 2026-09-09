'use strict';

const fs = require('fs');
const path = require('path');
const { queryOne } = require('../db/database');
const { hasCapability } = require('../middleware/auth');

function getAppVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
    return pkg.version || '2.5.0';
  } catch (e) {
    return '2.5.0';
  }
}

/**
 * Живое обновление разделов (дашборд, админка: периоды/гранты/пользователи)
 * без внешней инфраструктуры (нет WebSocket-сервера, нет Redis).
 *
 * Раньше здесь был SSE-эндпоинт с 25-секундным соединением (streamController).
 * На Vercel это плохо ложится: каждое открытое соединение держит инвокацию
 * serverless-функции открытой на весь свой срок, а переподключения EventSource
 * плодят инвокации. Поэтому канал сведён к простому опросу: фронт
 * (client/liveRefresh.js) раз в ~20 с дёргает /api/live-signature, сравнивает
 * компактную «подпись» релевантных ему данных и, если она изменилась,
 * перерисовывает текущий раздел.
 */

/** Компактный слепок того, что могло измениться и важно ИМЕННО этому
 *  пользователю — считаем только те части, на которые у него есть право,
 *  чтобы не гонять лишние запросы и не слать сигнал на данные, которые он
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

/** GET /api/live-signature — подпись релевантных пользователю данных. Фронт
 *  опрашивает и сравнивает со своей последней; при расхождении перерисовывает
 *  текущий раздел. Ошибку наружу не отдаём — фронт просто попробует на
 *  следующем тике. */
exports.signature = async (req, res) => {
  try {
    const sig = await signatureFor(req.user);
    res.json({ ok: true, sig, version: getAppVersion() });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'SIGNATURE_UNAVAILABLE' });
  }
};

exports.signatureFor = signatureFor;
