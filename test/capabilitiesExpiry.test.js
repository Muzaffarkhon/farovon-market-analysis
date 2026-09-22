'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isPersonalActive } = require('../src/middleware/auth');
const { CAPABILITIES, DEFAULT_ROLE_CAPABILITIES, ROLES } = require('../src/config/capabilities');

test('без expires_at — активно', () => {
  assert.equal(isPersonalActive({ effect: 'grant', expires_at: null }, '2026-09-22T10:00:00Z'), true);
});
test('expires_at в будущем — активно', () => {
  assert.equal(isPersonalActive({ effect: 'grant', expires_at: '2026-12-01T00:00:00Z' }, '2026-09-22T10:00:00Z'), true);
});
test('expires_at в прошлом — не активно', () => {
  assert.equal(isPersonalActive({ effect: 'deny', expires_at: '2026-01-01T00:00:00Z' }, '2026-09-22T10:00:00Z'), false);
});
test('нет записи — не активно', () => {
  assert.equal(isPersonalActive(null, '2026-09-22T10:00:00Z'), false);
});
test('survey:fill есть в каталоге и по умолчанию у всех ролей', () => {
  assert.ok(CAPABILITIES.some(c => c.id === 'survey:fill'));
  for (const r of ROLES) assert.ok(DEFAULT_ROLE_CAPABILITIES[r].includes('survey:fill'), r);
});
