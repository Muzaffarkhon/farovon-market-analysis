const crypto = require('crypto');
const config = require('../config');
const { runDaily } = require('../services/reminderService');

/** Та же схема, что у вебхук-секрета (telegramController.safeEqual) —
 *  сравнение постоянного времени, разная длина сразу не совпадает. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Vercel Cron дёргает этот маршрут по расписанию (`vercel.json` → `crons`).
 * Защищён секретом в заголовке, а не JWT — крон не логинится. Вся работа —
 * до `res.end()` (заморозка функции сразу после ответа, см. комментарий в
 * telegramController.webhook — тот же принцип).
 */
exports.dailyReminders = async (req, res) => {
  const header = req.headers.authorization || '';
  const expected = `Bearer ${config.cronSecret}`;
  if (!config.cronSecret || !safeEqual(header, expected)) {
    return res.status(401).end();
  }

  try {
    const result = await runDaily();
    res.status(200).json(result);
  } catch (err) {
    console.error('Cron reminders error:', err);
    res.status(500).json({ ok: false });
  }
};
