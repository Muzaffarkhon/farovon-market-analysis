'use strict';

const { queryOne } = require('../db/database');

/**
 * Текущий период сбора — строка periods с is_active = 1.
 *
 * Раньше «текущим» считалась просто самая новая строка (ORDER BY id DESC
 * LIMIT 1), и это определение было скопировано в полутора десятках мест.
 * Из-за него нельзя было вернуть прошлый период активным, не создавая копию
 * с новым id (что отвязало бы анкеты по surveys.period_id). Теперь активный
 * период помечен явно, а его смена — это UPDATE is_active, а не INSERT (см.
 * adminController.setPeriod и docs/superpowers/specs/2026-09-06-period-restore-design.md).
 *
 * Фолбэки на случай рассинхрона (обычно их не должно происходить — миграция
 * и setPeriod поддерживают инвариант «ровно одна активная строка»):
 *   1. нет активной строки → берём новейшую (прежнее поведение);
 *   2. таблица periods пуста → синтетический период по умолчанию.
 *
 * @returns {Promise<{id:number|null, name:string, state:string, from_date?:string, to_date?:string, updated_by?:string, updated_at?:string, is_active?:number}>}
 */
async function getActivePeriod() {
  return (await queryOne('SELECT * FROM periods WHERE is_active = 1 LIMIT 1'))
    || (await queryOne('SELECT * FROM periods ORDER BY id DESC LIMIT 1'))
    || { id: null, name: 'Обзор рынка', state: 'открыт' };
}

/**
 * Что именно делает вызов POST /admin/period. Чистая функция ради
 * тестируемости: разбирает тело запроса в одно из четырёх действий.
 *
 *   close    — закрыть активный период (правка строки, без новой)
 *   reopen   — снова открыть активный период (undo случайного «Закрыть»)
 *   new      — открыть новый период (новая строка становится активной)
 *   activate — вернуть активным ранее созданный период по id
 *              (undo случайного «Открыть новый»; поднять архивный год)
 *   edit     — обновить название и/или даты активного периода
 *
 * Явный body.action имеет приоритет. Иначе — обратная совместимость со
 * старым контрактом { state, name }: state='закрыт' → close; state='открыт'
 * с именем → new; state='открыт' без имени → reopen. (Старый фронт всегда
 * слал имя при открытии, так что «reopen» из легаси-вызова не приходит —
 * только из новой кнопки.)
 *
 * @param {{action?:string, state?:string, name?:string, id?:number|string, periodId?:number|string}} body
 * @returns {{action:'close'|'reopen'|'new'|'activate'|'edit', name:string|null, id:number|null} | {error:string}}
 */
function resolvePeriodAction(body = {}) {
  const name = (body.name && String(body.name).trim()) ? String(body.name).trim() : null;
  const rawId = body.id != null ? body.id : body.periodId;
  const id = (rawId === undefined || rawId === null || rawId === '') ? null : Number(rawId);

  let action = body.action ? String(body.action).trim().toLowerCase() : null;

  if (!action) {
    const state = String(body.state || 'открыт').trim().toLowerCase();
    if (state === 'закрыт') action = 'close';
    else action = name ? 'new' : 'reopen';
  }

  if (!['close', 'reopen', 'new', 'activate', 'edit'].includes(action)) {
    return { error: 'Неизвестное действие с периодом' };
  }
  if (action === 'new' && !name) {
    return { error: 'Не указано название нового периода' };
  }
  if (action === 'activate' && !Number.isFinite(id)) {
    return { error: 'Не указан период для восстановления' };
  }
  return { action, name, id };
}

module.exports = { getActivePeriod, resolvePeriodAction };
