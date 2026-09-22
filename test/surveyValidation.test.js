'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fx = require('./fixtures/surveyValidation.json');
const {
  validateSurveyItem, isStarted, parseMoney, missingRequired
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

// ── Обязательные поля: строго с новых, мягко с нетронутых старых ────────────
// Старый клиент шлёт весь список подразделения целиком при каждом сохранении;
// неполная строка из импорта Excel не должна блокировать сохранение соседних.

const FULL = { schedule: '5/2', bonHas: 'нет', source: 'Опрос', trust: 'высокая' };
const EMPTY = { schedule: '', bonHas: '', source: '', trust: '' };

test('новая полная запись — пусто', () => {
  assert.deepEqual(missingRequired(FULL, null), {});
});

test('новая запись без обязательных — названы все четыре', () => {
  const m = missingRequired({ schedule: '', bonHas: '', source: ' ', trust: null }, null);
  assert.deepEqual(Object.keys(m).sort(), ['bonHas', 'schedule', 'source', 'trust']);
});

test('новая запись: пустое «есть ли премии» — ошибка, «не знаю» — нет', () => {
  assert.ok(missingRequired({ ...FULL, bonHas: '' }, null).bonHas);
  assert.deepEqual(missingRequired({ ...FULL, bonHas: 'не знаю' }, null), {});
});

test('нетронутая неполная строка из импорта проходит как есть', () => {
  assert.deepEqual(missingRequired(EMPTY, EMPTY), {});
});

test('заполненное в базе поле нельзя очистить', () => {
  const m = missingRequired({ ...FULL, trust: '' }, FULL);
  assert.deepEqual(Object.keys(m), ['trust']);
});

test('у частично заполненной старой записи требуется только то, что уже было', () => {
  const stored = { schedule: '5/2', bonHas: '', source: '', trust: '' };
  assert.deepEqual(missingRequired(EMPTY, stored), { schedule: 'Укажите график работы' });
});

test('дозаполнение старой неполной записи не требует остального', () => {
  const stored = EMPTY;
  assert.deepEqual(missingRequired({ ...EMPTY, schedule: '6/1' }, stored), {});
});

test('parseMoney', () => {
  assert.equal(parseMoney('12 000,50'), 12000.5);
  assert.equal(parseMoney(''), 0);
  assert.equal(parseMoney(null), 0);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney('1.5.2'), null);
});
