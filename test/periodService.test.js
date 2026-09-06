'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolvePeriodAction } = require('../src/services/periodService');

// ── Явный action ──────────────────────────────────────────────────────────
test('resolvePeriodAction: явный close', () => {
  assert.deepEqual(resolvePeriodAction({ action: 'close' }), { action: 'close', name: null, id: null });
});

test('resolvePeriodAction: явный reopen', () => {
  assert.deepEqual(resolvePeriodAction({ action: 'reopen' }), { action: 'reopen', name: null, id: null });
});

test('resolvePeriodAction: new требует имя', () => {
  assert.deepEqual(
    resolvePeriodAction({ action: 'new', name: '  Обзор 2027  ' }),
    { action: 'new', name: 'Обзор 2027', id: null }
  );
  assert.ok(resolvePeriodAction({ action: 'new' }).error);
  assert.ok(resolvePeriodAction({ action: 'new', name: '   ' }).error);
});

test('resolvePeriodAction: activate требует числовой id', () => {
  assert.deepEqual(
    resolvePeriodAction({ action: 'activate', id: '7' }),
    { action: 'activate', name: null, id: 7 }
  );
  assert.deepEqual(
    resolvePeriodAction({ action: 'activate', periodId: 4 }),
    { action: 'activate', name: null, id: 4 }
  );
  assert.ok(resolvePeriodAction({ action: 'activate' }).error);
  assert.ok(resolvePeriodAction({ action: 'activate', id: 'abc' }).error);
});

test('resolvePeriodAction: неизвестное действие → ошибка', () => {
  assert.ok(resolvePeriodAction({ action: 'destroy' }).error);
});

test('resolvePeriodAction: регистр и пробелы в action не важны', () => {
  assert.equal(resolvePeriodAction({ action: '  CLOSE ' }).action, 'close');
});

// ── Обратная совместимость со старым контрактом { state, name } ────────────
test('resolvePeriodAction: легаси state=закрыт → close', () => {
  assert.equal(resolvePeriodAction({ state: 'закрыт' }).action, 'close');
});

test('resolvePeriodAction: легаси state=открыт + name → new (старый фронт всегда слал имя)', () => {
  const r = resolvePeriodAction({ state: 'открыт', name: 'Обзор рынка — сентябрь 2026 г.' });
  assert.equal(r.action, 'new');
  assert.equal(r.name, 'Обзор рынка — сентябрь 2026 г.');
});

test('resolvePeriodAction: легаси state=открыт без имени → reopen', () => {
  assert.equal(resolvePeriodAction({ state: 'открыт' }).action, 'reopen');
});

test('resolvePeriodAction: пустое тело → reopen (state по умолчанию открыт, имени нет)', () => {
  assert.equal(resolvePeriodAction().action, 'reopen');
  assert.equal(resolvePeriodAction({}).action, 'reopen');
});
