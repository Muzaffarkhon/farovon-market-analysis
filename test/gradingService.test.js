'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calcWeightedScore, calcGrade, evaluatePosition, evaluateRisk, GradingError
} = require('../src/services/gradingService');

test('производство: 4 фактора со своими весами', () => {
  // 5×0.30 + 4×0.30 + 3×0.25 + 2×0.15 = 1.5 + 1.2 + 0.75 + 0.3 = 3.75
  assert.equal(calcWeightedScore('production', [5, 4, 3, 2]), 3.75);
  assert.equal(calcGrade('production', 3.75), 3);
});

test('максимум и минимум шкалы', () => {
  assert.equal(calcWeightedScore('aup', [5, 5, 5]), 5);
  assert.equal(calcGrade('aup', 5), 1);
  assert.equal(calcWeightedScore('aup', [1, 1, 1]), 1);
  // У торгового и АУП шкала 5 → 1, поэтому балл ниже 1.70 — это уровень 5.
  assert.equal(calcGrade('aup', 1), 5);
  // У производства та же ситуация даёт самый низкий уровень 6.
  assert.equal(calcGrade('production', 1), 6);
});

test('границы диапазонов попадают в старший уровень', () => {
  assert.equal(calcGrade('auxiliary', 4.60), 1);
  assert.equal(calcGrade('auxiliary', 4.59), 2);
  assert.equal(calcGrade('auxiliary', 4.00), 2);
  assert.equal(calcGrade('auxiliary', 3.99), 3);
  assert.equal(calcGrade('auxiliary', 3.30), 3);
  assert.equal(calcGrade('auxiliary', 2.50), 4);
  assert.equal(calcGrade('auxiliary', 1.70), 5);
  assert.equal(calcGrade('auxiliary', 1.69), 6);
});

test('торговый персонал: вес первого фактора половина', () => {
  // 4×0.50 + 2×0.30 + 1×0.20 = 2 + 0.6 + 0.2 = 2.8
  const r = evaluatePosition('sales', [4, 2, 1]);
  assert.equal(r.weightedScore, 2.8);
  assert.equal(r.gradeLevel, 4);
  assert.equal(r.groupType, 'sales');
});

test('неверные данные анкеты не проходят', () => {
  assert.throws(() => calcWeightedScore('production', [5, 4, 3]), GradingError);   // пропущен фактор
  assert.throws(() => calcWeightedScore('aup', [5, 4, 6]), GradingError);          // балл вне 1–5
  assert.throws(() => calcWeightedScore('aup', [5, 4, 2.5]), GradingError);        // дробная оценка
  assert.throws(() => calcWeightedScore('director', [5, 4, 3]), GradingError);     // нет такой группы
});

test('риск: сумма четырёх факторов и статус', () => {
  const low = evaluateRisk({ bus_factor: 1, replacement_time: 2, knowledge_monopoly: 2, financial_risk: 2 });
  assert.equal(low.totalScore, 7);
  assert.equal(low.status, 'standard');

  const mid = evaluateRisk({ bus_factor: 3, replacement_time: 3, knowledge_monopoly: 2, financial_risk: 1 });
  assert.equal(mid.totalScore, 9);
  assert.equal(mid.status, 'attention');

  const high = evaluateRisk({ bus_factor: 5, replacement_time: 5, knowledge_monopoly: 5, financial_risk: 5 });
  assert.equal(high.totalScore, 20);
  assert.equal(high.status, 'critical');
  assert.match(high.recommendation, /дублёра/);
});

test('риск: границы 8 и 13 остаются в младшем статусе', () => {
  assert.equal(evaluateRisk({ bus_factor: 2, replacement_time: 2, knowledge_monopoly: 2, financial_risk: 2 }).status, 'standard');
  assert.equal(evaluateRisk({ bus_factor: 3, replacement_time: 2, knowledge_monopoly: 2, financial_risk: 2 }).status, 'attention');
  assert.equal(evaluateRisk({ bus_factor: 4, replacement_time: 3, knowledge_monopoly: 3, financial_risk: 3 }).status, 'attention');
  assert.equal(evaluateRisk({ bus_factor: 4, replacement_time: 4, knowledge_monopoly: 3, financial_risk: 3 }).status, 'critical');
});

test('риск: пропущенный ответ — ошибка, а не ноль', () => {
  assert.throws(() => evaluateRisk({ bus_factor: 3, replacement_time: 3, knowledge_monopoly: 3 }), GradingError);
});

// ─── Границы видимости (контроллер) ───

const { allowedUnits, unitScopeSql } = require('../src/controllers/gradingController');

test('admin и cb видят холдинг целиком', () => {
  assert.equal(allowedUnits({ role: 'admin', units: [] }), null);
  assert.equal(allowedUnits({ role: 'cb', units: [] }), null);
  assert.equal(unitScopeSql({ role: 'cb' }, 'r.unit').sql, '');
});

test('остальные роли ограничены своими подразделениями', () => {
  const user = { role: 'head', units: ['Цех упаковки К1', 'Элеваторная К1'] };
  assert.deepEqual(allowedUnits(user), user.units);
  const scope = unitScopeSql(user, 'r.unit');
  assert.equal(scope.sql, ' AND r.unit IN (?,?)');
  assert.deepEqual(scope.args, user.units);
});

test('пользователь без подразделений не получает чужие строки', () => {
  const scope = unitScopeSql({ role: 'user', units: [] }, 'r.unit');
  assert.equal(scope.sql, ' AND 1 = 0');
  assert.deepEqual(scope.args, []);
});

// ─── Тексты анкет ───

const { GROUP_FACTORS, RISK_FACTORS } = require('../src/config/gradingFactors');
const { GROUPS, RISK_FACTOR_FIELDS } = require('../src/services/gradingService');

test('у каждой группы столько факторов, сколько весов, и по 5 вариантов ответа', () => {
  Object.keys(GROUPS).forEach(key => {
    const factors = GROUP_FACTORS[key];
    assert.equal(factors.length, GROUPS[key].weights.length, 'группа ' + key);
    factors.forEach(f => {
      assert.equal(f.options.length, 5, f.code);
      assert.ok(f.title.length > 0, f.code);
    });
  });
});

test('вопросы анкеты рисков совпадают с колонками базы по порядку', () => {
  assert.deepEqual(RISK_FACTORS.map(f => f.field), RISK_FACTOR_FIELDS);
  RISK_FACTORS.forEach(f => assert.equal(f.options.length, 5, f.code));
});

// ─── Правка формулировок анкет ───

const factorsService = require('../src/services/gradingFactorsService');

test('правка анкеты: пустой вопрос и неполные варианты не проходят', async () => {
  await assert.rejects(
    () => factorsService.saveFactor({ scope: 'production', idx: 1, title: '', options: ['а', 'б', 'в', 'г', 'д'] }),
    /пустой/i
  );
  await assert.rejects(
    () => factorsService.saveFactor({ scope: 'production', idx: 1, title: 'Вопрос', options: ['а', 'б', 'в'] }),
    /5 вариантов/
  );
  await assert.rejects(
    () => factorsService.saveFactor({ scope: 'production', idx: 1, title: 'Вопрос', options: ['а', 'б', 'в', 'г', '  '] }),
    /5 вариантов/
  );
});

test('правка анкеты: чужая анкета и номер вне диапазона не проходят', async () => {
  await assert.rejects(
    () => factorsService.saveFactor({ scope: 'директора', idx: 1, title: 'Вопрос', options: ['а', 'б', 'в', 'г', 'д'] }),
    /Неизвестная анкета/
  );
  // У АУП три фактора — четвёртого вопроса не существует.
  await assert.rejects(
    () => factorsService.saveFactor({ scope: 'aup', idx: 4, title: 'Вопрос', options: ['а', 'б', 'в', 'г', 'д'] }),
    /номер вопроса/
  );
});
