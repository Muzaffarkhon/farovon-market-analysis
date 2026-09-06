'use strict';

const { queryOne } = require('../db/database');
const { getActivePeriod } = require('./periodService');

/**
 * expires_at приходит из SQLite как наивная строка "YYYY-MM-DD HH:MM:SS" (без
 * временной зоны), записанная datetime('now', ...) — то есть UTC. JS-конструктор
 * Date трактует такую строку (пробел вместо "T", нет "Z"/смещения) как ЛОКАЛЬНОЕ
 * время, а не UTC — на сервере в Asia/Dushanbe (UTC+5) это сдвигает момент
 * истечения на ~5 часов вперёд. SQL-сравнения (WHERE expires_at > CURRENT_TIMESTAMP)
 * этой проблемы не имеют — обе стороны там наивные UTC-строки. Тот же приём,
 * что и в public/app-core.js:fmtDateTime — помечаем строку как UTC явно.
 */
function toUtcMs(s) {
  if (!s) return NaN;
  const str = String(s);
  const iso = /[Zz]|[+\-]\d{2}:?\d{2}$/.test(str) ? str : str.replace(' ', 'T') + 'Z';
  return new Date(iso).getTime();
}

/**
 * Активен ли грант с таким сроком истечения на момент `nowIso`. Чистая
 * функция ради тестируемости без обращения к БД — реальный текущий момент
 * передаётся явно вызывающим кодом (`new Date().toISOString()`).
 */
function isGrantActive(expiresAt, nowIso) {
  if (!expiresAt) return false;
  return toUtcMs(expiresAt) > toUtcMs(nowIso);
}

/**
 * Решает, какой период редактировать, и имеет ли пользователь на это право.
 *
 * - Не передан periodId (или передан id последнего периода) → текущий год,
 *   доступен как обычно (без проверки гранта — это не архив).
 * - Передан id архивного (не последнего) периода:
 *   - admin → разрешено всегда, без гранта;
 *   - иначе → только если в period_edit_grants есть живая (не истёкшая)
 *     запись на этого user_login + этот periodId.
 *
 * См. docs/superpowers/specs/2026-09-05-archive-edit-access-design.md.
 *
 * @param {string|number|null|undefined} requestedPeriodId
 * @param {{ role: string, login: string }} user
 * @returns {Promise<{ok:true, period:{id:number|null,state:string,name:string}} | {ok:false,status:number,error:string}>}
 */
async function resolveEditablePeriod(requestedPeriodId, user) {
  const active = await getActivePeriod();
  const latest = {
    id: active.id,
    state: active.state,
    name: active.name || 'Обзор рынка'
  };

  const requested = (requestedPeriodId === null || requestedPeriodId === undefined || requestedPeriodId === '')
    ? null
    : Number(requestedPeriodId);

  if (requested === null || requested === latest.id) {
    return { ok: true, period: latest };
  }

  // Архивный период — целевой периода должен реально существовать.
  const target = await queryOne('SELECT id, state, name FROM periods WHERE id = ?', [requested]);
  if (!target) {
    return { ok: false, status: 404, error: 'Период не найден' };
  }

  if (user.role === 'admin') {
    return { ok: true, period: target };
  }

  const grant = await queryOne(
    'SELECT expires_at FROM period_edit_grants WHERE user_login = ? AND period_id = ?',
    [user.login, requested]
  );
  if (!grant || !isGrantActive(grant.expires_at, new Date().toISOString())) {
    return { ok: false, status: 403, error: 'Нет доступа к редактированию этого периода' };
  }

  return { ok: true, period: target };
}

module.exports = { isGrantActive, resolveEditablePeriod };
