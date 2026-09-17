'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calcWeightedScore, calcGrade, evaluatePosition, evaluateRisk, GradingError, CRITERIA_WEIGHTS
} = require('../src/services/gradingService');

test('единая анкета: 7 факторов со своими весами', () => {
  // Веса К1..К7 = 0.10, 0.10, 0.15, 0.15, 0.15, 0.15, 0.20 (сумма 100%).
  // 5×.10 + 4×.10 + 3×.15 + 2×.15 + 2×.15 + 1×.15 + 3×.20 = .5+.4+.45+.3+.3+.15+.6 = 2.7
  assert.equal(calcWeightedScore([5, 4, 3, 2, 2, 1, 3]), 2.7);
  assert.equal(calcGrade(2.7), 3);
});

test('максимум и минимум шкалы', () => {
  assert.equal(calcWeightedScore([5, 5, 5, 5, 5, 5, 5]), 5);
  assert.equal(calcGrade(5), 5);
  assert.equal(calcWeightedScore([1, 1, 1, 1, 1, 1, 1]), 1);
  // Балл 1.00 — это самый младший уровень шкалы (Группа I), второго дна нет.
  assert.equal(calcGrade(1), 1);
});

test('границы диапазонов попадают в старшую (по баллу) группу', () => {
  assert.equal(calcGrade(4.20), 5);
  assert.equal(calcGrade(4.19), 4);
  assert.equal(calcGrade(3.40), 4);
  assert.equal(calcGrade(3.39), 3);
  assert.equal(calcGrade(2.60), 3);
  assert.equal(calcGrade(1.80), 2);
  assert.equal(calcGrade(1.79), 1);
  assert.equal(calcGrade(1.00), 1);
});

test('evaluatePosition считает балл и уровень одним вызовом', () => {
  const r = evaluatePosition([4, 4, 4, 3, 3, 2, 4]);
  // 4×.10 + 4×.10 + 4×.15 + 3×.15 + 3×.15 + 2×.15 + 4×.20 = .4+.4+.6+.45+.45+.3+.8 = 3.4
  assert.equal(r.weightedScore, 3.4);
  assert.equal(r.gradeLevel, 4);
  assert.deepEqual(r.factors, [4, 4, 4, 3, 3, 2, 4]);
});

test('веса семи факторов складываются в 100%', () => {
  const sum = CRITERIA_WEIGHTS.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.equal(CRITERIA_WEIGHTS.length, 7);
});

test('неверные данные анкеты не проходят', () => {
  assert.throws(() => calcWeightedScore([5, 4, 3, 2, 2, 1]), GradingError);          // пропущен фактор
  assert.throws(() => calcWeightedScore([5, 4, 6, 2, 2, 1, 1]), GradingError);       // балл вне 1–5
  assert.throws(() => calcWeightedScore([5, 4, 2.5, 2, 2, 1, 1]), GradingError);     // дробная оценка
  assert.throws(() => calcWeightedScore([5, 4, 3, 2, 2, 1, 1, 1]), GradingError);    // лишний фактор
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

const { CRITERIA, RISK_FACTORS } = require('../src/config/gradingFactors');
const { RISK_FACTOR_FIELDS } = require('../src/services/gradingService');

test('единая анкета: 7 факторов, у каждого по 5 вариантов ответа', () => {
  assert.equal(CRITERIA.length, 7);
  CRITERIA.forEach(f => {
    assert.equal(f.options.length, 5, f.code);
    assert.ok(f.title.length > 0, f.code);
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
    () => factorsService.saveFactor({ scope: 'position', idx: 1, title: '', options: ['а', 'б', 'в', 'г', 'д'] }),
    /пустой/i
  );
  await assert.rejects(
    () => factorsService.saveFactor({ scope: 'position', idx: 1, title: 'Вопрос', options: ['а', 'б', 'в'] }),
    /5 вариантов/
  );
  await assert.rejects(
    () => factorsService.saveFactor({ scope: 'position', idx: 1, title: 'Вопрос', options: ['а', 'б', 'в', 'г', '  '] }),
    /5 вариантов/
  );
});

test('правка анкеты: чужая анкета и номер вне диапазона не проходят', async () => {
  await assert.rejects(
    () => factorsService.saveFactor({ scope: 'директора', idx: 1, title: 'Вопрос', options: ['а', 'б', 'в', 'г', 'д'] }),
    /Неизвестная анкета/
  );
  // В единой анкете 7 вопросов — восьмого не существует.
  await assert.rejects(
    () => factorsService.saveFactor({ scope: 'position', idx: 8, title: 'Вопрос', options: ['а', 'б', 'в', 'г', 'д'] }),
    /номер вопроса/
  );
});

test('формулировка направления перекрывает общую, остальные направления её не видят', () => {
  const row = (scope, idx, dir, title) => ({
    scope, idx, dir, code: 'К' + idx, title, help: '',
    option_1: 'а', option_2: 'б', option_3: 'в', option_4: 'г', option_5: 'д'
  });
  const rows = [
    row('position', 1, '', 'Общий вопрос 1'),
    row('position', 1, 'Мука', 'Про мельницу'),
    row('position', 2, '', 'Общий вопрос 2')
  ];

  const мука = factorsService.pickForDir(rows, 'Мука');
  assert.equal(мука.position[0].title, 'Про мельницу');
  assert.equal(мука.position[0].dir, 'Мука');
  // Второй вопрос своей формулировки не имеет — берётся общая.
  assert.equal(мука.position[1].title, 'Общий вопрос 2');
  assert.equal(мука.position[1].dir, '');

  const масло = factorsService.pickForDir(rows, 'Масло');
  assert.equal(масло.position[0].title, 'Общий вопрос 1');

  const общая = factorsService.pickForDir(rows, '');
  assert.equal(общая.position[0].title, 'Общий вопрос 1');
});
