'use strict';

/**
 * Чистая часть логики заявок на изменение зарплаты — без обращений к БД,
 * поэтому проверяется юнит-тестами напрямую (см. test/salaryRequestLogic.test.js),
 * тем же приёмом, что gradingService.calcWeightedScore/calcGrade.
 */

const STEPS = ['cb_manager', 'hrd', 'committee'];
const STEP_CAPABILITY = { cb_manager: 'salary:approve_cb', hrd: 'salary:approve_hrd' };

const REASON_CODES = {
  position_change: 'Переход на другую должность',
  probation_end: 'Выход из стажировки',
  individual_results: 'Индивидуальный подход — значимые результаты, отмеченные руководителем',
  benchmark: 'Данные бенчмаркинга рынка',
  grading: 'Результат грейдирования',
  free_text: 'Другое'
};

class SalaryRequestError extends Error {}

function nextStep(step) {
  const i = STEPS.indexOf(step);
  return i >= 0 && i < STEPS.length - 1 ? STEPS[i + 1] : null;
}

/** Бросает SalaryRequestError на некорректный набор оснований, иначе возвращает очищенный список. */
function validateReasons(reasons, reasonText) {
  const list = (Array.isArray(reasons) ? reasons : []).filter(r => REASON_CODES[r]);
  if (!list.length) throw new SalaryRequestError('Выберите хотя бы одно основание');
  if (list.includes('free_text') && !String(reasonText || '').trim()) {
    throw new SalaryRequestError('Для основания «Другое» нужно описать причину текстом');
  }
  return list;
}

/**
 * Сумма/процент — оба варианта разрешены (см. §3 хендоффа): если сумма не
 * задана явно, считаем от процента и известного текущего оклада. Без суммы
 * и без известного текущего оклада процент посчитать не от чего.
 */
function computeProposedSalary({ proposedSalary, proposedPercent, currentSalary }) {
  const explicit = Number(proposedSalary);
  if (explicit > 0) return explicit;
  const percent = Number(proposedPercent);
  if (percent && currentSalary) return Math.round(currentSalary * (1 + percent / 100));
  throw new SalaryRequestError('Укажите новый оклад суммой или процентом (при известном текущем окладе)');
}

/**
 * Итог голосования комиссии по уже собранным решениям (единогласно):
 * любой отказ — сразу 'rejected'; когда одобрили все члены текущего
 * состава — 'approved'; иначе 'pending' (ждём остальных).
 */
function committeeOutcome(members, decisions) {
  if (decisions.some(d => d.decision === 'rejected')) return 'rejected';
  if (!members.length) return 'pending';
  const approved = new Set(decisions.filter(d => d.decision === 'approved').map(d => d.approver_login));
  return members.every(m => approved.has(m)) ? 'approved' : 'pending';
}

module.exports = {
  STEPS, STEP_CAPABILITY, REASON_CODES, SalaryRequestError,
  nextStep, validateReasons, computeProposedSalary, committeeOutcome
};
