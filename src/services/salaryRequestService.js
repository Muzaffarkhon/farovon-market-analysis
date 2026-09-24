'use strict';

/**
 * Заявки на изменение зарплаты — слой с обращениями к БД. Чистые правила
 * (валидация оснований, расчёт суммы, итог голосования комиссии) вынесены в
 * salaryRequestLogic.js и проверяются юнит-тестами напрямую.
 *
 * «Текущий оклад» нигде не хранится отдельной колонкой (staff_directory
 * целиком пересоздаётся при каждом импорте из 1С — см. комментарий у
 * миграции) — это всегда последняя запись salary_history по паре (unit,fio).
 */

const { queryAll, queryOne, run } = require('../db/database');
const {
  STEPS, STEP_CAPABILITY, REASON_CODES,
  nextStep, validateReasons, computeProposedSalary, committeeOutcome
} = require('./salaryRequestLogic');

async function getCurrentSalary(unit, fio) {
  const row = await queryOne(
    'SELECT new_salary FROM salary_history WHERE unit = ? AND fio = ? ORDER BY changed_at DESC, id DESC LIMIT 1',
    [unit, fio]);
  return row ? Number(row.new_salary) : null;
}

/** Штат из 1С с последним известным окладом (для пикера сотрудника в форме заявки). */
async function employeeOptions(query) {
  const q = String(query || '').trim().toLowerCase();
  const rows = await queryAll('SELECT id, unit, fio, position FROM staff_directory ORDER BY unit, fio');
  const filtered = q
    ? rows.filter(r => r.fio.toLowerCase().includes(q) || r.unit.toLowerCase().includes(q))
    : rows;
  const limited = filtered.slice(0, 50);
  const out = [];
  for (const r of limited) {
    out.push({ id: r.id, unit: r.unit, fio: r.fio, position: r.position || '', currentSalary: await getCurrentSalary(r.unit, r.fio) });
  }
  return out;
}

async function createRequest({ unit, fio, position, proposedSalary, proposedPercent, reasons, reasonText, createdBy }) {
  if (!unit || !fio) throw new Error('Не выбран сотрудник');
  const validReasons = validateReasons(reasons, reasonText);
  const currentSalary = await getCurrentSalary(unit, fio);
  const salary = computeProposedSalary({ proposedSalary, proposedPercent, currentSalary });

  const ins = await run(
    `INSERT INTO salary_requests (unit, fio, position, current_salary, proposed_salary, proposed_percent, reasons, reason_text, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [unit, fio, position || null, currentSalary, salary, proposedPercent || null, JSON.stringify(validReasons), reasonText || null, createdBy]);
  return getRequest(Number(ins.lastInsertRowid || ins.insertId || 0));
}

function mapRequest(r) {
  return {
    id: r.id, unit: r.unit, fio: r.fio, position: r.position || '',
    currentSalary: r.current_salary == null ? null : Number(r.current_salary),
    proposedSalary: Number(r.proposed_salary),
    proposedPercent: r.proposed_percent == null ? null : Number(r.proposed_percent),
    reasons: JSON.parse(r.reasons || '[]'),
    reasonText: r.reason_text || '',
    status: r.status, step: r.step,
    createdBy: r.created_by, createdAt: r.created_at, decidedAt: r.decided_at
  };
}

async function getRequest(id) {
  const row = await queryOne('SELECT * FROM salary_requests WHERE id = ?', [id]);
  if (!row) return null;
  const decisions = await queryAll(
    'SELECT step, approver_login, decision, comment, decided_at FROM salary_request_decisions WHERE request_id = ? ORDER BY decided_at', [id]);
  return { ...mapRequest(row), decisions };
}

/** Очередь на решение для конкретного шага. */
async function listQueue(step) {
  const rows = await queryAll(
    "SELECT * FROM salary_requests WHERE status = 'pending' AND step = ? ORDER BY created_at", [step]);
  return rows.map(mapRequest);
}

async function listAll({ status } = {}) {
  const rows = status
    ? await queryAll('SELECT * FROM salary_requests WHERE status = ? ORDER BY created_at DESC', [status])
    : await queryAll('SELECT * FROM salary_requests ORDER BY created_at DESC');
  return rows.map(mapRequest);
}

async function listCommitteeMembers() {
  const rows = await queryAll('SELECT user_login FROM salary_committee_members ORDER BY user_login');
  return rows.map(r => r.user_login);
}
async function addCommitteeMember(login) {
  await run('INSERT OR IGNORE INTO salary_committee_members (user_login) VALUES (?)', [login]);
}
async function removeCommitteeMember(login) {
  await run('DELETE FROM salary_committee_members WHERE user_login = ?', [login]);
}

async function reject(request, step, approverLogin, comment) {
  await run(
    'INSERT INTO salary_request_decisions (request_id, step, approver_login, decision, comment) VALUES (?, ?, ?, ?, ?)',
    [request.id, step, approverLogin, 'rejected', comment || null]);
  await run("UPDATE salary_requests SET status = 'rejected', decided_at = CURRENT_TIMESTAMP WHERE id = ?", [request.id]);
}

async function finalizeApproved(request) {
  const oldSalary = await getCurrentSalary(request.unit, request.fio);
  await run(
    'INSERT INTO salary_history (unit, fio, old_salary, new_salary, request_id, changed_by) VALUES (?, ?, ?, ?, ?, ?)',
    [request.unit, request.fio, oldSalary, request.proposed_salary, request.id, 'salary-committee']);
  await run("UPDATE salary_requests SET status = 'approved', step = 'done', decided_at = CURRENT_TIMESTAMP WHERE id = ?", [request.id]);
}

/**
 * Решение по заявке на конкретном шаге. cb_manager/hrd — один согласующий,
 * решение сразу двигает заявку. committee — единогласно, итог считает
 * committeeOutcome() из salaryRequestLogic по уже накопленным голосам.
 */
async function decide({ requestId, step, approverLogin, decision, comment }) {
  const row = await queryOne('SELECT * FROM salary_requests WHERE id = ?', [requestId]);
  if (!row) throw new Error('Заявка не найдена');
  if (row.status !== 'pending') throw new Error('Заявка уже решена');
  if (row.step !== step) throw new Error('Заявка сейчас на другом шаге согласования');

  if (decision === 'rejected') {
    await reject(row, step, approverLogin, comment);
    return getRequest(requestId);
  }
  if (decision !== 'approved') throw new Error('Некорректное решение');

  if (step === 'cb_manager' || step === 'hrd') {
    await run(
      'INSERT INTO salary_request_decisions (request_id, step, approver_login, decision, comment) VALUES (?, ?, ?, ?, ?)',
      [requestId, step, approverLogin, 'approved', comment || null]);
    await run('UPDATE salary_requests SET step = ? WHERE id = ?', [nextStep(step), requestId]);
    return getRequest(requestId);
  }

  await run(
    `INSERT INTO salary_request_decisions (request_id, step, approver_login, decision, comment) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(request_id, step, approver_login) DO UPDATE SET decision = excluded.decision, comment = excluded.comment, decided_at = CURRENT_TIMESTAMP`,
    [requestId, step, approverLogin, 'approved', comment || null]);
  const members = await listCommitteeMembers();
  const decisions = await queryAll(
    "SELECT approver_login, decision FROM salary_request_decisions WHERE request_id = ? AND step = 'committee'", [requestId]);
  if (committeeOutcome(members, decisions) === 'approved') await finalizeApproved(row);
  return getRequest(requestId);
}

async function listHistory({ unit, fio } = {}) {
  if (unit && fio) {
    return queryAll('SELECT * FROM salary_history WHERE unit = ? AND fio = ? ORDER BY changed_at DESC', [unit, fio]);
  }
  return queryAll('SELECT * FROM salary_history ORDER BY changed_at DESC LIMIT 300');
}

module.exports = {
  STEPS, STEP_CAPABILITY, REASON_CODES,
  createRequest, getRequest, listQueue, listAll,
  listCommitteeMembers, addCommitteeMember, removeCommitteeMember,
  decide, listHistory, employeeOptions, getCurrentSalary
};
