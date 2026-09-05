'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isGrantActive } = require('../src/services/periodAccessService');

test('isGrantActive: срок ещё не истёк → true', () => {
  assert.equal(isGrantActive('2026-09-06T10:00:00.000Z', '2026-09-06T09:00:00.000Z'), true);
});

test('isGrantActive: срок истёк → false', () => {
  assert.equal(isGrantActive('2026-09-06T08:00:00.000Z', '2026-09-06T09:00:00.000Z'), false);
});

test('isGrantActive: ровно в момент истечения → false (не включительно)', () => {
  assert.equal(isGrantActive('2026-09-06T09:00:00.000Z', '2026-09-06T09:00:00.000Z'), false);
});

test('isGrantActive: нет записи (null/undefined) → false', () => {
  assert.equal(isGrantActive(null, '2026-09-06T09:00:00.000Z'), false);
  assert.equal(isGrantActive(undefined, '2026-09-06T09:00:00.000Z'), false);
});
