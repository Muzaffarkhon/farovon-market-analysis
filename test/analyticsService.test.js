'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveDashboardPeriodId, pushForkSample, forkStatsFromBuckets,
  positionTotalIncomeSamples, calculateSalaryForkStats
} = require('../src/services/analyticsService');

test('resolveDashboardPeriodId: пустая строка → текущий период', () => {
  assert.equal(resolveDashboardPeriodId('', 5), 5);
});

test('resolveDashboardPeriodId: undefined → текущий период', () => {
  assert.equal(resolveDashboardPeriodId(undefined, 5), 5);
});

test('resolveDashboardPeriodId: явный id → используется он', () => {
  assert.equal(resolveDashboardPeriodId('3', 5), 3);
});

test('resolveDashboardPeriodId: мусорная строка → текущий период', () => {
  assert.equal(resolveDashboardPeriodId('abc', 7), 7);
});

test('resolveDashboardPeriodId: нет текущего периода и явного id → null', () => {
  assert.equal(resolveDashboardPeriodId(undefined, null), null);
});

test('resolveDashboardPeriodId: id=0 или отрицательный — не валиден, фолбэк на текущий', () => {
  assert.equal(resolveDashboardPeriodId('0', 5), 5);
  assert.equal(resolveDashboardPeriodId('-1', 5), 5);
});

// ── Разрезы дашборда (этап 3) ───────────────────────────────────────────────

test('pushForkSample: копит froms/tos/mids по ключу, пустую сумму игнорирует', () => {
  const buckets = {};
  pushForkSample(buckets, 'высокая', 5000, 7000, 6000);
  pushForkSample(buckets, 'высокая', 4000, 6000, 5000);
  pushForkSample(buckets, 'низкая', 0, 0, 0); // mid=0 — не участвует
  assert.deepEqual(Object.keys(buckets), ['высокая']);
  assert.deepEqual(buckets['высокая'].mids, [6000, 5000]);
  assert.deepEqual(buckets['высокая'].froms, [5000, 4000]);
});

test('forkStatsFromBuckets: вилка по каждому ключу, отсортировано по медиане', () => {
  const buckets = {
    'низкая': { froms: [1000], tos: [2000], mids: [1500] },
    'высокая': { froms: [5000, 6000], tos: [7000, 8000], mids: [6000, 7000] }
  };
  const res = forkStatsFromBuckets(buckets, 'trust', calculateSalaryForkStats);
  assert.equal(res[0].trust, 'высокая'); // медиана больше — первая
  assert.equal(res[0].count, 2);
  assert.equal(res[1].trust, 'низкая');
  assert.equal(res[1].count, 1);
});

test('forkStatsFromBuckets: пустых групп не бывает — ключ появляется только если был push', () => {
  const res = forkStatsFromBuckets({}, 'source', calculateSalaryForkStats);
  assert.deepEqual(res, []);
});

const company = (over = {}) => ({
  avg: 5000, cur: 'сомони', bonHas: 'нет', varPay: { has: false, monthly: null }, ...over
});

test('positionTotalIncomeSamples: явное «нет премии» — известный ноль', () => {
  assert.deepEqual(positionTotalIncomeSamples([company()]), [5000]);
});

test('positionTotalIncomeSamples: премия есть и посчитана — прибавляется к окладу', () => {
  const res = positionTotalIncomeSamples([company({ bonHas: 'да', varPay: { has: true, monthly: 500 } })]);
  assert.deepEqual(res, [5500]);
});

test('positionTotalIncomeSamples: премия есть, но размер не распознан — компания не участвует', () => {
  const res = positionTotalIncomeSamples([company({ bonHas: 'да', varPay: { has: true, monthly: null } })]);
  assert.deepEqual(res, []);
});

test('positionTotalIncomeSamples: без оклада — не участвует', () => {
  assert.deepEqual(positionTotalIncomeSamples([company({ avg: 0 })]), []);
});

test('positionTotalIncomeSamples: валюта не сомони — не участвует', () => {
  assert.deepEqual(positionTotalIncomeSamples([company({ cur: 'доллар' })]), []);
});

test('positionTotalIncomeSamples: смесь компаний — каждая по своему правилу', () => {
  const res = positionTotalIncomeSamples([
    company(),                                                        // 5000
    company({ bonHas: 'да', varPay: { has: true, monthly: 1000 } }),  // 6000
    company({ bonHas: 'да', varPay: { has: true, monthly: null } }),  // исключена
    company({ cur: 'USD' })                                           // исключена
  ]);
  assert.deepEqual(res, [5000, 6000]);
});
