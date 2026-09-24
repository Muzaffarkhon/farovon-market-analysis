'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { splitFioList, joinFioList } = require('../src/services/fioResolver');

test('splitFioList: делит по запятой, обрезает пробелы, пропускает пустые', () => {
  assert.deepEqual(splitFioList('Иванов Иван,  Петров Пётр , ,Сидоров Сидор'), [
    'Иванов Иван', 'Петров Пётр', 'Сидоров Сидор'
  ]);
});

test('splitFioList: пусто/null/undefined — пустой массив', () => {
  assert.deepEqual(splitFioList(''), []);
  assert.deepEqual(splitFioList(null), []);
  assert.deepEqual(splitFioList(undefined), []);
});

test('joinFioList: убирает дубли без учёта регистра, сохраняет первое написание', () => {
  assert.equal(joinFioList(['Иванов Иван', 'иванов иван', 'Петров Пётр']), 'Иванов Иван, Петров Пётр');
});

test('joinFioList: пустые элементы и пустой массив', () => {
  assert.equal(joinFioList(['', '  ', 'Иванов Иван']), 'Иванов Иван');
  assert.equal(joinFioList([]), '');
});

test('split → join — идемпотентно на чистом списке', () => {
  const list = 'Иванов Иван, Петров Пётр';
  assert.equal(joinFioList(splitFioList(list)), list);
});
