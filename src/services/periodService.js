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

module.exports = { getActivePeriod };
