'use strict';

/**
 * Ежедневный планировщик напоминаний (ТЗ, раздел 8, п.5) — раньше вся
 * рассылка была ручной кнопкой, крона в системе не было вообще. Сбор
 * годовой, кампания редкая и длинная — про неё успевают забыть, поэтому
 * ритм: на старте кампании, затем раз в неделю пока есть незакрытые
 * должности, далее за две недели, за неделю и за день до закрытия.
 *
 * Вызывается ежедневно с Vercel Cron (`POST /api/cron/reminders`,
 * cronController.js) — сама рассылка (`sendMassReminder`) уже фильтрует
 * получателей по тем, у кого реально есть незакрытое.
 */

const { run } = require('../db/database');
const { getActivePeriod } = require('./periodService');

const DAY_MS = 86400000;

function daysBetween(fromISO, toISO) {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / DAY_MS);
}

/**
 * Какой тир напоминаний сегодня, по датам активного периода. Несколько
 * тиров в один день не пересекаются по построению интервалов (14/7/1 дней
 * до конца — разные даты, старт кампании — ещё одна отдельная дата), но на
 * случай совпадения — приоритет более срочному: t-1 > t-7 > t-14 > weekly
 * > start. `today`/`fromDate`/`toDate` — строки 'YYYY-MM-DD'. Чистая
 * функция ради тестируемости без реальной даты и без БД.
 */
function resolveTier(today, fromDate, toDate) {
  if (!fromDate || !toDate) return null;

  const daysToClose = daysBetween(today, toDate);
  if (daysToClose === 1) return 't-1';
  if (daysToClose === 7) return 't-7';
  if (daysToClose === 14) return 't-14';

  if (today === fromDate) return 'start';

  const sinceStart = daysBetween(fromDate, today);
  // Кампания уже идёт (после старта) и ещё не закрылась — раз в неделю,
  // тем же днём недели, что и старт.
  if (sinceStart > 0 && daysToClose > 0 && sinceStart % 7 === 0) return 'weekly';

  return null;
}

/**
 * `today` — 'YYYY-MM-DD' (по умолчанию — реальное сегодня); параметр
 * существует ради тестов и ручной проверки конкретной даты.
 */
async function runDaily(today = new Date().toISOString().slice(0, 10)) {
  const period = await getActivePeriod();
  const tier = resolveTier(today, period.from_date, period.to_date);
  if (!tier || !period.id) return { ok: true, tier: null, sent: 0 };

  // INSERT OR IGNORE — если тир уже отправлен сегодня (повторный вызов
  // cron'а/ручной ретрай), выходим без повторной рассылки.
  const inserted = await run(
    'INSERT OR IGNORE INTO reminder_log (period_id, tier, sent_on) VALUES (?, ?, ?)',
    [period.id, tier, today]
  );
  if (!inserted.rowsAffected) return { ok: true, tier, alreadySent: true, sent: 0 };

  const { sendMassReminder } = require('./telegramService');
  const result = await sendMassReminder();
  return { ok: true, tier, sent: result.sent, uncompletedCount: result.uncompletedCount };
}

module.exports = { resolveTier, runDaily };
