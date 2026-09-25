'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  checkEligibility, growthPercent, compaRatio, vilkaPosition, committeeOutcome, nextStatusAfterHrd
} = require('../src/services/compReviewLogic');

test('checkEligibility: без истории — всегда можно, не исключение', () => {
  assert.deepEqual(
    checkEligibility({ lastReviewDate: null, today: '2026-09-24', reasonCode: 'promotion', reasonText: '' }),
    { eligible: true, isException: false }
  );
});

test('checkEligibility: ровно 6 месяцев — уже можно без исключения', () => {
  const r = checkEligibility({ lastReviewDate: '2026-03-24', today: '2026-09-24', reasonCode: 'promotion', reasonText: '' });
  assert.equal(r.eligible, true);
  assert.equal(r.isException, false);
});

test('checkEligibility: 5 месяцев без кода исключения — отказ', () => {
  const r = checkEligibility({ lastReviewDate: '2026-04-24', today: '2026-09-24', reasonCode: 'promotion', reasonText: '' });
  assert.equal(r.eligible, false);
  assert.ok(r.reason);
});

test('checkEligibility: 5 месяцев, код "выравнивание" (не исключение) — всё равно отказ', () => {
  const r = checkEligibility({ lastReviewDate: '2026-04-24', today: '2026-09-24', reasonCode: 'alignment', reasonText: 'обоснование' });
  assert.equal(r.eligible, false);
});

test('checkEligibility: 5 месяцев, retention с текстом — можно, исключение', () => {
  const r = checkEligibility({ lastReviewDate: '2026-04-24', today: '2026-09-24', reasonCode: 'retention', reasonText: 'контр-оффер от конкурента' });
  assert.equal(r.eligible, true);
  assert.equal(r.isException, true);
});

test('checkEligibility: unique_case без текста обоснования — отказ', () => {
  const r = checkEligibility({ lastReviewDate: '2026-04-24', today: '2026-09-24', reasonCode: 'unique_case', reasonText: '   ' });
  assert.equal(r.eligible, false);
});

test('checkEligibility: 5 месяцев, но меняется должность — можно, не исключение', () => {
  const r = checkEligibility({ lastReviewDate: '2026-04-24', today: '2026-09-24', reasonCode: 'promotion', reasonText: '', positionChanged: true });
  assert.equal(r.eligible, true);
  assert.equal(r.isException, false);
});

test('growthPercent: считает рост, null без текущего оклада', () => {
  assert.equal(growthPercent(10000, 11000), 10);
  assert.equal(growthPercent(0, 11000), null);
  assert.equal(growthPercent(null, 11000), null);
});

test('compaRatio: доля от рыночной медианы', () => {
  assert.equal(compaRatio(13000, 10000), 1.3);
  assert.equal(compaRatio(10000, 0), null);
});

test('vilkaPosition: 0% на "от", 100% на "до", вне вилки не ограничивается', () => {
  assert.equal(vilkaPosition(10000, 20000, 10000), 0);
  assert.equal(vilkaPosition(10000, 20000, 20000), 100);
  assert.equal(vilkaPosition(10000, 20000, 15000), 50);
  assert.equal(vilkaPosition(10000, 20000, 25000), 150);
  assert.equal(vilkaPosition(0, 0, 15000), null);
});

test('committeeOutcome: большинство от состава, а не от проголосовавших', () => {
  const snapshot = ['a', 'b', 'c'];
  assert.equal(committeeOutcome(snapshot, []), 'pending');
  assert.equal(committeeOutcome(snapshot, [{ voter_login: 'a', vote: 'for' }]), 'pending');
  assert.equal(committeeOutcome(snapshot, [{ voter_login: 'a', vote: 'for' }, { voter_login: 'b', vote: 'for' }]), 'approved');
  assert.equal(committeeOutcome(snapshot, [{ voter_login: 'a', vote: 'against' }, { voter_login: 'b', vote: 'against' }]), 'rejected');
});

test('committeeOutcome: голос выбывшего из снимка состава не учитывается', () => {
  const snapshot = ['a', 'b', 'c'];
  const votes = [{ voter_login: 'a', vote: 'for' }, { voter_login: 'stranger', vote: 'for' }];
  assert.equal(committeeOutcome(snapshot, votes), 'pending'); // 1 из 3, а не 2 из 3
});

test('committeeOutcome: чётный состав, ровно половина — не большинство', () => {
  const snapshot = ['a', 'b', 'c', 'd'];
  const votes = [{ voter_login: 'a', vote: 'for' }, { voter_login: 'b', vote: 'for' }];
  assert.equal(committeeOutcome(snapshot, votes), 'pending');
});

test('committeeOutcome: большинство за совместное совещание', () => {
  const snapshot = ['a', 'b', 'c'];
  const votes = [{ voter_login: 'a', vote: 'meeting' }, { voter_login: 'b', vote: 'meeting' }, { voter_login: 'c', vote: 'for' }];
  assert.equal(committeeOutcome(snapshot, votes), 'meeting');
});

test('nextStatusAfterHrd: стажировка минует комиссию', () => {
  assert.equal(nextStatusAfterHrd('probation_end'), 'payroll');
  assert.equal(nextStatusAfterHrd('planned'), 'committee');
  assert.equal(nextStatusAfterHrd('counter_offer'), 'committee');
  assert.equal(nextStatusAfterHrd('unique_case'), 'committee');
});
