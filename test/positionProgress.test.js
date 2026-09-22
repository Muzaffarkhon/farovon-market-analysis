'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { positionProgress, surveyHasSubstance } = require('../src/services/analyticsService');

const empty = { posOur: 'X', payFrom: 0, payTo: 0, bonuses: [], benefits: [], extra: '', note: '' };

test('должность решена, если есть заполненная компания или «не с кем»', () => {
  const r = positionProgress({
    positions: ['Токарь', 'Сварщик', 'Кладовщик', 'Бухгалтер'],
    surveys: [
      { ...empty, posOur: 'Токарь', payFrom: 5000 },
      { ...empty, posOur: 'Сварщик' }
    ],
    noComparison: ['Кладовщик']
  });
  assert.deepEqual(r, { decided: 2, total: 4 });
});

test('нормализация ё/регистра/пробелов', () => {
  const r = positionProgress({ positions: ['Слесарь-ремонтник'], surveys: [{ ...empty, posOur: 'слесарь-РЕМОНТНИК ', payFrom: 1 }], noComparison: [] });
  assert.deepEqual(r, { decided: 1, total: 1 });
});

test('пустая штатка → 0 из 0', () => {
  assert.deepEqual(positionProgress({ positions: [], surveys: [], noComparison: [] }), { decided: 0, total: 0 });
});

test('surveyHasSubstance: комментарий, льготы (строкой и списком), бонус с размером', () => {
  assert.equal(surveyHasSubstance(empty), false);
  assert.equal(surveyHasSubstance({ ...empty, note: 'x' }), true);
  assert.equal(surveyHasSubstance({ ...empty, benefits: 'ДМС' }), true);
  assert.equal(surveyHasSubstance({ ...empty, benefits: ['ДМС'] }), true);
  assert.equal(surveyHasSubstance({ ...empty, bonuses: [{ type: 'KPI', size: '', per: '' }] }), false);
  assert.equal(surveyHasSubstance({ ...empty, bonuses: [{ type: 'KPI', size: '10%', per: '' }] }), true);
});
