'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeBonuses, bonusesLegacy, bonusesFromRow
} = require('../src/controllers/surveyController');
const {
  summarizeVarPay, parseBonusesCol, parseBonusSize, perToMonthlyFactor, normPeriod,
  calculateSalaryForkStats
} = require('../src/services/analyticsService');

// fmtNum использует toLocaleString('ru-RU') → неразрывные пробелы. В сравнениях
// приводим к обычному пробелу.
const sp = (s) => String(s).replace(/[   ]/g, ' ');

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

test('parseBonusesCol: фолбэк на bon_* когда bonuses пуст / список пустых объектов', () => {
  assert.deepEqual(parseBonusesCol('[]', 'KPI', '10', 'в месяц'), [{ type: 'KPI', size: '10', per: 'в месяц' }]);
  assert.deepEqual(parseBonusesCol('[{"type":"","size":"","per":""}]', 'KPI', '10', ''), [{ type: 'KPI', size: '10', per: '' }]);
});

// ─── Finding 43: parseBonusSize — границы и разделители тысяч ───
test('parseBonusSize: пробел/точка/запятая как разделитель тысяч', () => {
  assert.deepEqual(parseBonusSize('50 000'), { kind: 'abs', value: 50000 });
  assert.deepEqual(parseBonusSize('3 000'), { kind: 'abs', value: 3000 });
  assert.deepEqual(parseBonusSize('50.000'), { kind: 'abs', value: 50000 });
  assert.deepEqual(parseBonusSize('50,000'), { kind: 'abs', value: 50000 });
});

test('parseBonusSize: явная единица важнее порога', () => {
  assert.deepEqual(parseBonusSize('20%'), { kind: 'pct', value: 20 });
  assert.deepEqual(parseBonusSize('3000 c'), { kind: 'abs', value: 3000 });
  assert.deepEqual(parseBonusSize('150%'), { kind: 'pct', value: 150 });
});

test('parseBonusSize: голое число — ≤100 процент, >100 сумма', () => {
  assert.equal(parseBonusSize('20').kind, 'pct');
  assert.equal(parseBonusSize('100').kind, 'pct');
  assert.equal(parseBonusSize('101').kind, 'abs');
});

test('parseBonusSize: оклад/зарплата → salary; мусор/пусто/ноль → unknown', () => {
  assert.deepEqual(parseBonusSize('1 оклад'), { kind: 'salary', value: 1 });
  assert.deepEqual(parseBonusSize('по решению'), { kind: 'unknown', value: 0 });
  assert.deepEqual(parseBonusSize(''), { kind: 'unknown', value: 0 });
  assert.deepEqual(parseBonusSize('0'), { kind: 'unknown', value: 0 });
  assert.deepEqual(parseBonusSize('-20'), { kind: 'unknown', value: 0 });
});

// ─── Finding 42: periods — все 5 значений формы через оба преобразования ───
test('normPeriod + perToMonthlyFactor: все значения bonusPeriods формы', () => {
  const expect = {
    'в месяц': 1,
    'в квартал': 1 / 3,
    'в полугодие': 1 / 6,
    'в год': 1 / 12,
    'разово': 1 / 12
  };
  for (const [raw, factor] of Object.entries(expect)) {
    const np = normPeriod(raw);
    assert.equal(perToMonthlyFactor(np), factor, `${raw} → ${np}`);
  }
});

test('normPeriod: легаси и англ. написания', () => {
  assert.equal(normPeriod('Месячный'), 'в месяц');
  assert.equal(normPeriod('Квартальный'), 'в квартал');
  assert.equal(normPeriod('Годовой'), 'в год');
  assert.equal(normPeriod('раз в полгода'), 'в полугодие');
  assert.equal(normPeriod('annually'), 'в год');
});

// ─── summarizeVarPay ───
test('summarizeVarPay: один вид в процентах', () => {
  const r = summarizeVarPay([{ type: 'KPI', size: '20', per: 'в месяц' }], 'да', 4000);
  assert.equal(sp(r.label), 'KPI · 20%');
  assert.equal(r.monthly, 800);
  assert.equal(r.has, true);
});

test('summarizeVarPay: один вид суммой, годовой → делится на 12', () => {
  const r = summarizeVarPay([{ type: 'Годовой', size: '3000', per: 'в год' }], 'да', 4000);
  assert.equal(sp(r.label), 'Годовой · 3 000 c');
  assert.equal(r.monthly, 250);
});

test('summarizeVarPay: полугодовой бонус → делится на 6 (Finding 2)', () => {
  const r = summarizeVarPay([{ type: 'X', size: '1200', per: 'в полугодие' }], 'да', 10000);
  assert.equal(r.monthly, 200);
});

test('summarizeVarPay: разовый бонус амортизируется на год (Finding 1)', () => {
  const r = summarizeVarPay([{ type: '13-я', size: '12000', per: 'разово' }], 'да', 10000);
  assert.equal(r.monthly, 1000);
});

test('summarizeVarPay: два вида одной периодичности в % — суммируются', () => {
  const r = summarizeVarPay(
    [{ type: 'KPI', size: '15%', per: 'ежемесячно' }, { type: 'План', size: '10', per: 'в месяц' }],
    'да', 5000
  );
  assert.equal(sp(r.label), '2 вида · ≈ 25%');
  assert.equal(r.monthly, 1250);
});

test('summarizeVarPay: два вида РАЗНОЙ периодичности — без свёрнутого числа (Finding 10)', () => {
  const r = summarizeVarPay(
    [{ type: 'KPI', size: '15%', per: 'в месяц' }, { type: 'Год', size: '10%', per: 'в год' }],
    'да', 5000
  );
  assert.equal(r.label, '2 вида');
});

test('summarizeVarPay: смешанные единицы → «N видов» без числа', () => {
  const r = summarizeVarPay(
    [{ type: 'KPI', size: '15', per: 'в месяц' }, { type: 'Бонус', size: '1 оклад', per: 'в месяц' }],
    'да', 4000
  );
  assert.equal(r.label, '2 вида');
});

test('summarizeVarPay: нет премии / не указано / пусто', () => {
  assert.equal(summarizeVarPay([], 'нет', 4000).label, 'без премии');
  assert.equal(summarizeVarPay([], 'да', 4000).label, 'не указано');
  assert.equal(summarizeVarPay([], '', 4000).label, '');
});

test('summarizeVarPay: bonHas с пробелом/регистром (Finding 24)', () => {
  assert.equal(summarizeVarPay([], ' Да ', 4000).label, 'не указано');
  assert.equal(summarizeVarPay([], 'НЕТ', 4000).label, 'без премии');
});

test('summarizeVarPay: размер не задан → периодичность, не «· —»', () => {
  const r = summarizeVarPay([{ type: '', size: '', per: 'в месяц' }], 'да', 4000);
  assert.equal(r.label, 'премия · в месяц');
});

test('summarizeVarPay: topPer стабилен при равенстве счётчиков (Finding 20)', () => {
  const a = summarizeVarPay([{ type: 'x', size: '1', per: 'в год' }, { type: 'y', size: '1', per: 'в месяц' }], 'да', 100);
  const b = summarizeVarPay([{ type: 'y', size: '1', per: 'в месяц' }, { type: 'x', size: '1', per: 'в год' }], 'да', 100);
  assert.equal(a.topPer, b.topPer);
  assert.equal(a.topPer, 'в месяц'); // «в месяц» раньше в PER_RANK
});

// ─── Finding 44: медиана (единый calculateSalaryForkStats) ───
test('calculateSalaryForkStats: медиана чётной длины — среднее двух средних', () => {
  const st = calculateSalaryForkStats([], [], [10, 20, 30, 40]);
  assert.equal(st.median, 25);
});

test('calculateSalaryForkStats: пустой вход → нули', () => {
  const st = calculateSalaryForkStats([], [], []);
  assert.equal(st.median, 0);
  assert.equal(st.p25, 0);
});
