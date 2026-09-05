'use strict';

const { queryOne } = require('../db/database');

/**
 * Активен ли грант с таким сроком истечения на момент `nowIso`. Чистая
 * функция ради тестируемости без обращения к БД — реальный текущий момент
 * передаётся явно вызывающим кодом (`new Date().toISOString()`).
 */
function isGrantActive(expiresAt, nowIso) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() > new Date(nowIso).getTime();
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
  const latest = (await queryOne('SELECT id, state, name FROM periods ORDER BY id DESC LIMIT 1'))
    || { id: null, state: 'открыт', name: 'Обзор рынка' };

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
