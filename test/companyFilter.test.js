'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isHiddenCompany } = require('../src/services/companyFilter');

test('isHiddenCompany: русское ООО в начале названия', () => {
  assert.equal(isHiddenCompany('ООО ПКО «РБР»'), true);
  assert.equal(isHiddenCompany('ооо ромашка'), true);
});

test('isHiddenCompany: таджикское ҶДММ (эквивалент ООО)', () => {
  assert.equal(isHiddenCompany('ҶДММ "Азамат Агро"'), true);
  assert.equal(isHiddenCompany('ҷдмм тест'), true);
});

test('isHiddenCompany: форма не в начале, но отдельным словом', () => {
  assert.equal(isHiddenCompany('Холдинг (ООО)'), true);
  assert.equal(isHiddenCompany('Компания ООО'), true);
});

test('isHiddenCompany: обычные компании не скрываются', () => {
  assert.equal(isHiddenCompany('Далерон'), false);
  assert.equal(isHiddenCompany('Пивоваренная компания'), false);
  assert.equal(isHiddenCompany('ЗАО Восток'), false);
});

test('isHiddenCompany: буквы формы внутри другого слова не считаются', () => {
  assert.equal(isHiddenCompany('ФОOОД'), false);
  assert.equal(isHiddenCompany('Гвоздоооптторг'), false);
});

test('isHiddenCompany: пустое / мусорное значение', () => {
  assert.equal(isHiddenCompany(''), false);
  assert.equal(isHiddenCompany(null), false);
  assert.equal(isHiddenCompany(undefined), false);
});
