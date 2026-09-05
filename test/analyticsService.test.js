'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveDashboardPeriodId } = require('../src/services/analyticsService');

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
