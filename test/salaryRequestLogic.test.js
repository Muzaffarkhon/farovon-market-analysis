'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  nextStep, validateReasons, computeProposedSalary, committeeOutcome, SalaryRequestError, STEPS
} = require('../src/services/salaryRequestLogic');

test('nextStep: cb_manager → hrd → committee → конец цепочки', () => {
  assert.equal(nextStep('cb_manager'), 'hrd');
  assert.equal(nextStep('hrd'), 'committee');
  assert.equal(nextStep('committee'), null);
  assert.deepEqual(STEPS, ['cb_manager', 'hrd', 'committee']);
});

test('validateReasons: без оснований — ошибка', () => {
  assert.throws(() => validateReasons([], ''), SalaryRequestError);
  assert.throws(() => validateReasons(undefined, ''), SalaryRequestError);
});

test('validateReasons: неизвестные коды отбрасываются', () => {
  assert.deepEqual(validateReasons(['grading', 'unknown_code'], ''), ['grading']);
});

test('validateReasons: «Другое» без текста — ошибка', () => {
  assert.throws(() => validateReasons(['free_text'], ''), SalaryRequestError);
  assert.throws(() => validateReasons(['free_text'], '   '), SalaryRequestError);
  assert.deepEqual(validateReasons(['free_text'], 'разовая корректировка'), ['free_text']);
});

test('validateReasons: несколько оснований сразу — можно', () => {
  assert.deepEqual(
    validateReasons(['benchmark', 'grading', 'position_change'], ''),
    ['benchmark', 'grading', 'position_change']
  );
});

test('computeProposedSalary: явная сумма — приоритет', () => {
  assert.equal(computeProposedSalary({ proposedSalary: 12000, proposedPercent: 50, currentSalary: 8000 }), 12000);
});

test('computeProposedSalary: процент считается от известного текущего оклада', () => {
  assert.equal(computeProposedSalary({ proposedSalary: 0, proposedPercent: 10, currentSalary: 10000 }), 11000);
});

test('computeProposedSalary: процент без известного текущего оклада — ошибка', () => {
  assert.throws(() => computeProposedSalary({ proposedSalary: 0, proposedPercent: 10, currentSalary: null }), SalaryRequestError);
});

test('computeProposedSalary: ни суммы, ни процента — ошибка', () => {
  assert.throws(() => computeProposedSalary({ currentSalary: 10000 }), SalaryRequestError);
});

test('committeeOutcome: пусто — ждём (не одобрено и не отклонено)', () => {
  assert.equal(committeeOutcome(['a', 'b', 'c'], []), 'pending');
});

test('committeeOutcome: любой отказ сразу отклоняет, даже если остальные ещё не голосовали', () => {
  const decisions = [{ approver_login: 'a', decision: 'rejected' }];
  assert.equal(committeeOutcome(['a', 'b', 'c'], decisions), 'rejected');
});

test('committeeOutcome: одобрено, только когда согласились все текущие члены', () => {
  const partial = [
    { approver_login: 'a', decision: 'approved' },
    { approver_login: 'b', decision: 'approved' }
  ];
  assert.equal(committeeOutcome(['a', 'b', 'c'], partial), 'pending');

  const full = [...partial, { approver_login: 'c', decision: 'approved' }];
  assert.equal(committeeOutcome(['a', 'b', 'c'], full), 'approved');
});

test('committeeOutcome: без членов в комиссии — ждём, а не «одобрено»', () => {
  assert.equal(committeeOutcome([], []), 'pending');
});
