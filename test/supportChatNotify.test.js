'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { shouldNotify } = require('../src/services/supportChatService');

const FIVE_MIN = 5 * 60 * 1000;

test('shouldNotify: ещё ни разу не уведомляли (null) — да', () => {
  assert.equal(shouldNotify(null), true);
  assert.equal(shouldNotify(undefined), true);
});

test('shouldNotify: невалидная дата — да (не блокируем уведомление из-за мусора в поле)', () => {
  assert.equal(shouldNotify('не дата'), true);
});

test('shouldNotify: уведомляли только что — нет', () => {
  const now = Date.now();
  assert.equal(shouldNotify(new Date(now).toISOString(), now), false);
  assert.equal(shouldNotify(new Date(now - 60000).toISOString(), now), false); // минуту назад
});

test('shouldNotify: ровно на границе throttle — да', () => {
  const now = Date.now();
  assert.equal(shouldNotify(new Date(now - FIVE_MIN).toISOString(), now), true);
});

test('shouldNotify: давно уведомляли — да', () => {
  const now = Date.now();
  assert.equal(shouldNotify(new Date(now - FIVE_MIN - 1000).toISOString(), now), true);
});
