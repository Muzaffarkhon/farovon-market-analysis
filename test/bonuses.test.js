'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeBonuses, bonusesLegacy, bonusesFromRow } = require('../src/controllers/surveyController');
const { summarizeVarPay, parseBonusesCol } = require('../src/services/analyticsService');

test('normalizeBonuses: строка JSON → чистый массив', () => {
  const out = normalizeBonuses('[{"type":"KPI","size":"15","per":"в месяц"},{"type":"","size":"","per":""}]');
  assert.deepEqual(out, [{ type: 'KPI', size: '15', per: 'в месяц' }]);
});

test('normalizeBonuses: мусор → []', () => {
  assert.deepEqual(normalizeBonuses('не json'), []);
  assert.deepEqual(normalizeBonuses(null), []);
  assert.deepEqual(normalizeBonuses(42), []);
});

test('bonusesLegacy: первый вид уходит в плоские поля, bon_has=да', () => {
  const leg = bonusesLegacy([{ type: 'KPI', size: '15', per: 'в месяц' }], 'нет');
  assert.equal(leg.bonHas, 'да');
  assert.equal(leg.bonType, 'KPI');
  assert.equal(leg.bonSize, '15');
});

test('bonusesLegacy: пустой список → bon_has из фронта', () => {
  assert.equal(bonusesLegacy([], 'нет').bonHas, 'нет');
  assert.equal(bonusesLegacy([], '').bonHas, 'не знаю');
});

test('bonusesFromRow: старая запись без JSON синтезирует один вид из bon_*', () => {
  const out = bonusesFromRow({ bonuses: '', bon_type: 'Годовой', bon_size: '3000', bon_per: 'в год' });
  assert.deepEqual(out, [{ type: 'Годовой', size: '3000', per: 'в год' }]);
});

test('parseBonusesCol: фолбэк на bon_* когда bonuses пуст', () => {
  assert.deepEqual(
    parseBonusesCol('[]', 'KPI', '10', 'в месяц'),
    [{ type: 'KPI', size: '10', per: 'в месяц' }]
  );
});

test('summarizeVarPay: один вид в процентах', () => {
  const r = summarizeVarPay([{ type: 'KPI', size: '20', per: 'в месяц' }], 'да', 4000);
  assert.equal(r.label, 'KPI · 20%');
  assert.equal(r.monthly, 800);
  assert.equal(r.has, true);
});

test('summarizeVarPay: один вид суммой, годовой → делится на 12', () => {
  const r = summarizeVarPay([{ type: 'Годовой', size: '3000', per: 'в год' }], 'да', 4000);
  assert.equal(r.label, 'Годовой · 3 000 c');
  assert.equal(r.monthly, 250);
});

test('summarizeVarPay: два вида в процентах суммируются', () => {
  const r = summarizeVarPay(
    [{ type: 'KPI', size: '15%', per: 'ежемесячно' }, { type: 'План', size: '10', per: 'в месяц' }],
    'да', 5000
  );
  assert.equal(r.label, '2 вида · ≈ 25%');
  assert.equal(r.monthly, 1250);
});

test('summarizeVarPay: смешанные единицы → «N видов» без числа', () => {
  const r = summarizeVarPay(
    [{ type: 'KPI', size: '15', per: 'в месяц' }, { type: 'Бонус', size: '1 оклад', per: 'в год' }],
    'да', 4000
  );
  assert.equal(r.label, '2 вида');
});

test('summarizeVarPay: нет премии / не указано', () => {
  assert.equal(summarizeVarPay([], 'нет', 4000).label, 'без премии');
  assert.equal(summarizeVarPay([], 'да', 4000).label, 'не указано');
  assert.equal(summarizeVarPay([], '', 4000).label, '');
});

test('summarizeVarPay: размер не задан → показываем периодичность, не «· —»', () => {
  const r = summarizeVarPay([{ type: '', size: '', per: 'в месяц' }], 'да', 4000);
  assert.equal(r.label, 'премия · в месяц');
});

test('summarizeVarPay: единый словарь периодичности (легаси → форма анкеты)', () => {
  const r = summarizeVarPay([{ type: 'X', size: '3000', per: 'Квартальный' }], 'да', 4000);
  assert.equal(r.topPer, 'в квартал');
});
