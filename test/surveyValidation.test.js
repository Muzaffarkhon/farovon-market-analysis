'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fx = require('./fixtures/surveyValidation.json');
const {
  validateSurveyItem, isStarted, parseMoney, contentSignature, missingRequired
} = require('../src/services/surveyValidation');

for (const c of fx.cases) {
  test('валидация: ' + c.name, () => {
    const r = validateSurveyItem(c.item, fx.refs);
    assert.equal(r.ok, c.ok, r.ok ? 'ожидали ошибку' : r.error);
    if (!c.ok) assert.ok(r.fields && r.fields[c.field], `ожидали ошибку в поле ${c.field}, получили ${JSON.stringify(r.fields)}`);
    if (c.started !== undefined) assert.equal(isStarted(c.item), c.started);
    if (c.ok && c.payFrom !== undefined) assert.equal(r.value.payFrom, c.payFrom);
    if (c.ok && c.payTo !== undefined) assert.equal(r.value.payTo, c.payTo);
    if (c.ok && c.company !== undefined) assert.equal(r.value.company, c.company);
    if (c.ok && c.note !== undefined) assert.equal(r.value.note, c.note);
    if (c.ok && c.cur !== undefined) assert.equal(r.value.cur, c.cur);
  });
}

test('requireForStarted:false — начатая запись без обязательных проходит (нетронутые старые строки)', () => {
  const r = validateSurveyItem({ company: 'А', posOur: 'Б', payFrom: '100' }, { ...fx.refs, requireForStarted: false });
  assert.equal(r.ok, true);
  assert.equal(r.value.payFrom, 100);
});

test('requireForStarted:false не отключает остальные правила', () => {
  const r = validateSurveyItem({ company: 'А', posOur: 'Б', payFrom: 'abc' }, { ...fx.refs, requireForStarted: false });
  assert.equal(r.ok, false);
  assert.ok(r.fields.payFrom);
});

// ── Строгая проверка только для новых и изменённых записей ──────────────────
// Старый клиент шлёт весь список подразделения целиком при каждом сохранении;
// нетронутая неполная строка (импорт Excel) не должна блокировать сохранение.

test('contentSignature: одинаковое содержимое — одинаковая подпись', () => {
  const a = { payFrom: 100, payTo: 200, cur: 'сомони', schedule: '5/2', note: 'x' };
  const b = { payFrom: '100', payTo: '200', cur: 'сомони', schedule: '5/2', note: 'x' };
  assert.equal(contentSignature(a), contentSignature(b));
});

test('contentSignature: изменение любого поля меняет подпись', () => {
  const base = { payFrom: 100, schedule: '5/2', source: 'Опрос', trust: 'высокая' };
  assert.notEqual(contentSignature(base), contentSignature({ ...base, payFrom: 101 }));
  assert.notEqual(contentSignature(base), contentSignature({ ...base, trust: 'низкая' }));
  assert.notEqual(contentSignature(base), contentSignature({ ...base, note: 'добавили' }));
});

test('contentSignature: null и пустая строка неразличимы (база отдаёт то одно, то другое)', () => {
  assert.equal(contentSignature({ note: null }), contentSignature({ note: '' }));
});

test('missingRequired: полная запись — пусто', () => {
  assert.deepEqual(missingRequired({ schedule: '5/2', bonHas: 'нет', source: 'Опрос', trust: 'высокая' }), {});
});

test('missingRequired: называет каждое недостающее поле', () => {
  const m = missingRequired({ schedule: '', bonHas: '', source: ' ', trust: null });
  assert.deepEqual(Object.keys(m).sort(), ['bonHas', 'schedule', 'source', 'trust']);
});

test('missingRequired: пустое «есть ли премии» — ошибка (не путать с «не знаю»)', () => {
  assert.ok(missingRequired({ schedule: '5/2', bonHas: '', source: 'Опрос', trust: 'высокая' }).bonHas);
  assert.deepEqual(missingRequired({ schedule: '5/2', bonHas: 'не знаю', source: 'Опрос', trust: 'высокая' }), {});
});

test('parseMoney', () => {
  assert.equal(parseMoney('12 000,50'), 12000.5);
  assert.equal(parseMoney(''), 0);
  assert.equal(parseMoney(null), 0);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney('1.5.2'), null);
});
