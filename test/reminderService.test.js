'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveTier } = require('../src/services/reminderService');

// Период: 2026-08-01 — 2026-08-31 (30 дней, старт — суббота).
const FROM = '2026-08-01';
const TO = '2026-08-31';

test('resolveTier: день старта кампании — start', () => {
  assert.equal(resolveTier(FROM, FROM, TO), 'start');
});

test('resolveTier: ровно за 14 дней до закрытия — t-14', () => {
  assert.equal(resolveTier('2026-08-17', FROM, TO), 't-14');
});

test('resolveTier: ровно за 7 дней до закрытия — t-7', () => {
  assert.equal(resolveTier('2026-08-24', FROM, TO), 't-7');
});

test('resolveTier: ровно за 1 день до закрытия — t-1', () => {
  assert.equal(resolveTier('2026-08-30', FROM, TO), 't-1');
});

test('resolveTier: тот же день недели, что старт, через неделю — weekly', () => {
  assert.equal(resolveTier('2026-08-08', FROM, TO), 'weekly'); // +7 дней от старта
  assert.equal(resolveTier('2026-08-15', FROM, TO), 'weekly'); // +14
});

test('resolveTier: день закрытия и обычные дни — ничего', () => {
  assert.equal(resolveTier(TO, FROM, TO), null); // сам день закрытия — не тир
  assert.equal(resolveTier('2026-08-05', FROM, TO), null); // не понедельник кампании и не t-N
});

test('resolveTier: день, который совпал бы с weekly, но он же t-7 — приоритет t-7', () => {
  // +21 от старта — 2026-08-22 — это weekly-кандидат, но не t-7. Берём
  // отдельно тот день, где weekly и t-N реально совпадают: если период
  // длиной ровно 7 дней, старт и t-7 — один день, start в приоритете
  // выше weekly, но t-7 (более срочный) должен победить и start тоже.
  const shortFrom = '2026-08-01';
  const shortTo = '2026-08-08'; // старт = t-7 до закрытия
  assert.equal(resolveTier(shortFrom, shortFrom, shortTo), 't-7');
});

test('resolveTier: нет дат активного периода — null', () => {
  assert.equal(resolveTier('2026-08-01', null, null), null);
  assert.equal(resolveTier('2026-08-01', FROM, null), null);
});
