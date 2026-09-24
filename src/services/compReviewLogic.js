'use strict';

/**
 * Чистая бизнес-логика «Пересмотра заработной платы» — без обращений к БД,
 * поэтому проверяется юнит-тестами напрямую (test/compReviewLogic.test.js).
 * Правила — docs/superpowers/specs/2026-09-22-comp-review-design.md.
 */

class CompReviewError extends Error {}

// §3 — тип заявки (шапка, один на всю заявку).
const REQUEST_TYPES = {
  planned: 'Плановый пересмотр',
  probation_end: 'Выход из стажировки',
  counter_offer: 'Контр-оффер',
  unique_case: 'Уникальный случай'
};

// §1/§3 — код основания (по каждому сотруднику). retention/unique_case —
// единственные коды, допускающие исключение из правила 6 месяцев (§2).
const REASON_CODES = {
  promotion: 'Повышение',
  probation_end: 'Окончание стажировки',
  market_adjustment: 'Рыночная корректировка',
  retention: 'Удержание / контр-оффер',
  alignment: 'Выравнивание',
  unique_case: 'Уникальный случай'
};
const EXCEPTION_REASON_CODES = new Set(['retention', 'unique_case']);
const ELIGIBILITY_MONTHS = 6;

function monthsBetween(fromISO, toISO) {
  const from = new Date(fromISO);
  const to = new Date(toISO);
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) +
    (to.getDate() < from.getDate() ? -1 : 0);
}

/**
 * Допуск сотрудника в заявку (§2): без истории — всегда можно (первый раз).
 * Меньше 6 месяцев с последнего пересмотра — можно только с кодом исключения
 * (retention/unique_case) и текстом обоснования; иначе отказ с причиной.
 */
function checkEligibility({ lastReviewDate, today, reasonCode, reasonText }) {
  if (!lastReviewDate) return { eligible: true, isException: false };
  const months = monthsBetween(lastReviewDate, today || new Date().toISOString().slice(0, 10));
  if (months >= ELIGIBILITY_MONTHS) return { eligible: true, isException: false };
  if (EXCEPTION_REASON_CODES.has(reasonCode) && String(reasonText || '').trim()) {
    return { eligible: true, isException: true };
  }
  return {
    eligible: false, isException: false,
    reason: `Последний пересмотр был меньше ${ELIGIBILITY_MONTHS} месяцев назад — нужен код исключения (удержание/контр-оффер или уникальный случай) и обоснование`
  };
}

/** Рост в процентах от текущего оклада к предлагаемому. null, если текущий не известен. */
function growthPercent(currentSalary, proposedSalary) {
  if (!currentSalary) return null;
  return Math.round(((proposedSalary - currentSalary) / currentSalary) * 1000) / 10;
}

/** Compa-ratio — предлагаемый оклад как доля от рыночной медианы (1 = ровно медиана). */
function compaRatio(proposedSalary, marketMedian) {
  if (!marketMedian) return null;
  return Math.round((proposedSalary / marketMedian) * 100) / 100;
}

/** Положение оклада в вилке должности, 0–100% («от» = 0%, «до» = 100%). null вне вилки/без вилки. */
function vilkaPosition(payFrom, payTo, salary) {
  if (!payFrom || !payTo || payTo <= payFrom) return null;
  return Math.round(((salary - payFrom) / (payTo - payFrom)) * 1000) / 10;
}

/**
 * Итог голосования комиссии по сотруднику (§5): большинство — от
 * ЗАФИКСИРОВАННОГО состава на момент передачи в комиссию (snapshot), не от
 * числа реально проголосовавших. 'pending', пока большинства ни в одну из
 * сторон нет — комиссия ждёт.
 */
function committeeOutcome(committeeSnapshot, votes) {
  const size = committeeSnapshot.length;
  if (!size) return 'pending';
  const valid = votes.filter(v => committeeSnapshot.includes(v.voter_login));
  const forCount = valid.filter(v => v.vote === 'for').length;
  const againstCount = valid.filter(v => v.vote === 'against').length;
  if (forCount > size / 2) return 'approved';
  if (againstCount > size / 2) return 'rejected';
  return 'pending';
}

/** Следующий этап заявки после согласования HRD (§2) — «стажировка» минует комиссию. */
function nextStatusAfterHrd(requestType) {
  return requestType === 'probation_end' ? 'payroll' : 'committee';
}

module.exports = {
  CompReviewError, REQUEST_TYPES, REASON_CODES, EXCEPTION_REASON_CODES, ELIGIBILITY_MONTHS,
  checkEligibility, growthPercent, compaRatio, vilkaPosition, committeeOutcome, nextStatusAfterHrd
};
