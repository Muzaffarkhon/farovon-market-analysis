'use strict';

/**
 * Пересмотр заработной платы — слой с обращениями к БД. Чистые правила
 * (допуск по 6 месяцам, рост/compa-ratio/вилка, итог голосования) — в
 * compReviewLogic.js, проверяются юнит-тестами напрямую.
 *
 * docs/superpowers/specs/2026-09-22-comp-review-design.md
 */

const crypto = require('crypto');
const { queryAll, queryOne, run } = require('../db/database');
const benchmarkService = require('./benchmarkService');
const { sendTelegramMessage, downloadTelegramFile, getBotUsername } = require('./telegramService');
const {
  REQUEST_TYPES, REASON_CODES, checkEligibility, growthPercent, compaRatio, vilkaPosition,
  committeeOutcome, nextStatusAfterHrd, CompReviewError
} = require('./compReviewLogic');

async function getLastReview(unit, fio) {
  const row = await queryOne(
    'SELECT effective_date, new_salary FROM comp_review_history WHERE unit = ? AND fio = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    [unit, fio]);
  return row ? { lastReviewDate: row.effective_date, currentSalary: row.new_salary == null ? null : Number(row.new_salary) } : { lastReviewDate: null, currentSalary: null };
}

async function employeeOptions(query) {
  const q = String(query || '').trim().toLowerCase();
  const rows = await queryAll('SELECT id, unit, fio, position FROM staff_directory ORDER BY unit, fio');
  const filtered = (q ? rows.filter(r => r.fio.toLowerCase().includes(q) || r.unit.toLowerCase().includes(q)) : rows).slice(0, 50);
  const out = [];
  for (const r of filtered) {
    const { lastReviewDate, currentSalary } = await getLastReview(r.unit, r.fio);
    out.push({ id: r.id, unit: r.unit, fio: r.fio, position: r.position || '', lastReviewDate, currentSalary });
  }
  return out;
}

/** Список должностей для выбора «назначаемой» при переводе (§3 ТЗ). */
async function positionOptions() {
  const rows = await queryAll('SELECT name FROM dictionary_positions ORDER BY name ASC');
  return rows.map(r => r.name);
}

async function getGradeRange(position) {
  if (!position) return { from: null, to: null };
  const row = await queryOne('SELECT pay_from, pay_to FROM dictionary_positions WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))', [position]);
  if (!row) return { from: null, to: null };
  return { from: Number(row.pay_from) || null, to: Number(row.pay_to) || null };
}

/** Рыночная медиана по должности из бенчмаркинга (§9.4) — если сопоставления нет, вызывающий сам оставляет поле пустым. */
async function fetchMarketMedian(position, user) {
  try {
    const r = await benchmarkService.compare({ positionName: position, user });
    return r.summary.compositeMedian || null;
  } catch {
    return null;
  }
}

/**
 * Режим «закрытое» голосование (§5): пока по сотруднику не подведён итог,
 * видно только «проголосовал / нет» — сам голос скрыт от всех, кроме автора
 * голоса. После итога (status !== 'active') голоса раскрываются всем.
 */
function maskVotes(rows, employeeStatus, voteMode, viewerLogin) {
  if (voteMode !== 'closed' || employeeStatus !== 'active') return rows;
  return rows.map(v => v.voterLogin === viewerLogin ? v : { ...v, vote: null, comment: null });
}

function mapEmployeeRow(r, variablePay, votes, voteMode, viewerLogin) {
  return {
    id: r.id, requestId: r.request_id, staffId: r.staff_id, fio: r.fio, unit: r.unit, position: r.position || '',
    newPosition: r.new_position || '',
    hireDate: r.hire_date, probationStartDate: r.probation_start_date, probationEndDate: r.probation_end_date,
    lastReviewDate: r.last_review_date, currentSalary: r.current_salary == null ? null : Number(r.current_salary),
    proposedSalary: Number(r.proposed_salary),
    growthPercent: growthPercent(r.current_salary, r.proposed_salary),
    gradePayFrom: r.grade_pay_from == null ? null : Number(r.grade_pay_from),
    gradePayTo: r.grade_pay_to == null ? null : Number(r.grade_pay_to),
    vilkaBefore: vilkaPosition(r.grade_pay_from, r.grade_pay_to, r.current_salary),
    vilkaAfter: vilkaPosition(r.grade_pay_from, r.grade_pay_to, r.proposed_salary),
    marketMin: r.market_min == null ? null : Number(r.market_min),
    marketMedian: r.market_median == null ? null : Number(r.market_median),
    marketMax: r.market_max == null ? null : Number(r.market_max),
    compaRatio: compaRatio(r.proposed_salary, r.market_median),
    reasonCode: r.reason_code, reasonText: r.reason_text || '',
    isException: !!r.is_exception,
    status: r.status, decidedAt: r.decided_at,
    payrollEnteredAt: r.payroll_entered_at, payrollEnteredBy: r.payroll_entered_by,
    payrollComment: r.payroll_comment || '', payrollEffectiveDate: r.payroll_effective_date,
    variablePay: (variablePay || []).map(v => ({
      id: v.id, kind: v.kind, amount: Number(v.amount), amountType: v.amount_type, period: v.period || '', isProposed: !!v.is_proposed
    })),
    votes: maskVotes(
      (votes || []).map(v => ({ voterLogin: v.voter_login, vote: v.vote, comment: v.comment || '', votedAt: v.voted_at })),
      r.status, voteMode, viewerLogin
    )
  };
}

async function loadEmployeeRows(requestId, includeVotes, voteMode, viewerLogin) {
  const rows = await queryAll('SELECT * FROM comp_request_employees WHERE request_id = ? ORDER BY id', [requestId]);
  return Promise.all(rows.map(async r => {
    const [vp, votes] = await Promise.all([
      queryAll('SELECT * FROM comp_variable_pay WHERE employee_row_id = ? ORDER BY id', [r.id]),
      includeVotes ? queryAll('SELECT * FROM comp_committee_votes WHERE employee_row_id = ? ORDER BY voted_at', [r.id]) : []
    ]);
    return mapEmployeeRow(r, vp, votes, voteMode, viewerLogin);
  }));
}

function mapRequest(r) {
  return {
    id: r.id, initiatorLogin: r.initiator_login, unit: r.unit || '',
    requestType: r.request_type, effectiveDate: r.effective_date, basisDocument: r.basis_document || '',
    comment: r.comment || '', status: r.status,
    committeeSize: r.committee_snapshot ? JSON.parse(r.committee_snapshot).length : 0,
    createdAt: r.created_at, updatedAt: r.updated_at
  };
}

async function getRequestRow(id) {
  const r = await queryOne('SELECT * FROM comp_requests WHERE id = ?', [id]);
  if (!r) throw new CompReviewError('Заявка не найдена');
  return r;
}

async function getRequest(id, viewerLogin) {
  const [r, settings] = await Promise.all([getRequestRow(id), getSettings()]);
  const [employees, activity] = await Promise.all([
    loadEmployeeRows(
      id, r.status === 'committee' || r.status === 'payroll' || r.status === 'closed', settings.voteMode, viewerLogin || null
    ),
    queryAll(
      `SELECT a.*, e.fio AS employee_fio FROM comp_activity a
       LEFT JOIN comp_request_employees e ON e.id = a.employee_row_id
       WHERE a.request_id = ? ORDER BY a.created_at`, [id])
  ]);
  return {
    ...mapRequest(r),
    employees,
    activity: activity.map(a => ({
      id: a.id, employeeFio: a.employee_fio || null, actorLogin: a.actor_login,
      action: a.action, comment: a.comment || '', createdAt: a.created_at
    }))
  };
}

async function logActivity(requestId, employeeRowId, actorLogin, action, comment) {
  await run(
    'INSERT INTO comp_activity (request_id, employee_row_id, actor_login, action, comment) VALUES (?, ?, ?, ?, ?)',
    [requestId, employeeRowId || null, actorLogin, action, comment || null]);
}

async function touchRequest(id) {
  await run("UPDATE comp_requests SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
}

// ─── Черновик ───

async function createDraft({ initiatorLogin, unit, requestType, effectiveDate, basisDocument, comment }) {
  if (!REQUEST_TYPES[requestType]) throw new CompReviewError('Некорректный тип заявки');
  const ins = await run(
    'INSERT INTO comp_requests (initiator_login, unit, request_type, effective_date, basis_document, comment) VALUES (?, ?, ?, ?, ?, ?)',
    [initiatorLogin, unit || null, requestType, effectiveDate || null, basisDocument || null, comment || null]);
  const id = Number(ins.lastInsertRowid || ins.insertId || 0);
  await logActivity(id, null, initiatorLogin, 'создал черновик', null);
  return getRequest(id, initiatorLogin);
}

async function requireDraft(id) {
  const r = await getRequestRow(id);
  if (r.status !== 'draft') throw new CompReviewError('Заявку можно менять только в черновике');
  return r;
}

async function updateDraftHeader(id, patch, actorLogin) {
  await requireDraft(id);
  const fields = [];
  const args = [];
  for (const [col, key] of [['unit', 'unit'], ['request_type', 'requestType'], ['effective_date', 'effectiveDate'], ['basis_document', 'basisDocument'], ['comment', 'comment']]) {
    if (patch[key] !== undefined) { fields.push(`${col} = ?`); args.push(patch[key] || null); }
  }
  if (fields.length) {
    args.push(id);
    await run(`UPDATE comp_requests SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, args);
  }
  return getRequest(id);
}

async function addEmployee(requestId, data, actorLogin) {
  await requireDraft(requestId);
  if (!REASON_CODES[data.reasonCode]) throw new CompReviewError('Некорректный код основания');
  if (!data.fio || !data.unit) throw new CompReviewError('Не выбран сотрудник');
  if (!(Number(data.proposedSalary) > 0)) throw new CompReviewError('Укажите предлагаемый оклад');

  const { lastReviewDate, currentSalary } = await getLastReview(data.unit, data.fio);
  const newPosition = (data.newPosition || '').trim() || null;
  const positionChanged = !!newPosition && newPosition.toLowerCase() !== String(data.position || '').trim().toLowerCase();
  const elig = checkEligibility({ lastReviewDate, reasonCode: data.reasonCode, reasonText: data.reasonText, positionChanged });
  if (!elig.eligible) throw new CompReviewError(elig.reason);

  // Вилка считается по назначаемой должности при переводе, иначе — по текущей.
  const grade = await getGradeRange(positionChanged ? newPosition : data.position);
  const ins = await run(
    `INSERT INTO comp_request_employees
       (request_id, staff_id, fio, unit, position, new_position, last_review_date, current_salary, proposed_salary,
        grade_pay_from, grade_pay_to, reason_code, reason_text, is_exception,
        hire_date, probation_start_date, probation_end_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [requestId, data.staffId || null, data.fio, data.unit, data.position || null, newPosition, lastReviewDate, currentSalary,
      Number(data.proposedSalary), grade.from, grade.to, data.reasonCode, data.reasonText || null, elig.isException ? 1 : 0,
      data.hireDate || null, data.probationStartDate || null, data.probationEndDate || null]);
  await logActivity(requestId, null, actorLogin, 'добавил сотрудника', data.fio);
  await touchRequest(requestId);
  return getRequest(requestId, actorLogin);
}

async function requireEmployeeInDraft(employeeId) {
  const row = await queryOne('SELECT * FROM comp_request_employees WHERE id = ?', [employeeId]);
  if (!row) throw new CompReviewError('Сотрудник не найден в заявке');
  const req = await getRequestRow(row.request_id);
  if (req.status !== 'draft') throw new CompReviewError('Заявку можно менять только в черновике');
  return row;
}

async function updateEmployee(employeeId, patch) {
  const row = await requireEmployeeInDraft(employeeId);
  const proposedSalary = patch.proposedSalary !== undefined ? Number(patch.proposedSalary) : row.proposed_salary;
  const reasonCode = patch.reasonCode !== undefined ? patch.reasonCode : row.reason_code;
  const reasonText = patch.reasonText !== undefined ? patch.reasonText : row.reason_text;
  const hireDate = patch.hireDate !== undefined ? (patch.hireDate || null) : row.hire_date;
  const probationStartDate = patch.probationStartDate !== undefined ? (patch.probationStartDate || null) : row.probation_start_date;
  const probationEndDate = patch.probationEndDate !== undefined ? (patch.probationEndDate || null) : row.probation_end_date;
  const newPosition = patch.newPosition !== undefined ? ((patch.newPosition || '').trim() || null) : row.new_position;
  if (!REASON_CODES[reasonCode]) throw new CompReviewError('Некорректный код основания');
  const positionChanged = !!newPosition && newPosition.toLowerCase() !== String(row.position || '').trim().toLowerCase();
  const elig = checkEligibility({ lastReviewDate: row.last_review_date, reasonCode, reasonText, positionChanged });
  if (!elig.eligible) throw new CompReviewError(elig.reason);

  const grade = await getGradeRange(positionChanged ? newPosition : row.position);
  await run(
    `UPDATE comp_request_employees SET proposed_salary = ?, reason_code = ?, reason_text = ?, is_exception = ?,
       hire_date = ?, probation_start_date = ?, probation_end_date = ?, new_position = ?, grade_pay_from = ?, grade_pay_to = ? WHERE id = ?`,
    [proposedSalary, reasonCode, reasonText || null, elig.isException ? 1 : 0,
      hireDate, probationStartDate, probationEndDate, newPosition, grade.from, grade.to, employeeId]);
  await touchRequest(row.request_id);
  return getRequest(row.request_id);
}

async function removeEmployee(employeeId, actorLogin) {
  const row = await requireEmployeeInDraft(employeeId);
  await run('DELETE FROM comp_variable_pay WHERE employee_row_id = ?', [employeeId]);
  await run('DELETE FROM comp_request_employees WHERE id = ?', [employeeId]);
  await logActivity(row.request_id, null, actorLogin, 'убрал сотрудника из заявки', row.fio);
  await touchRequest(row.request_id);
  return getRequest(row.request_id);
}

async function addVariablePay(employeeId, data) {
  const row = await requireEmployeeInDraft(employeeId);
  if (!(Number(data.amount) > 0)) throw new CompReviewError('Укажите размер');
  await run(
    'INSERT INTO comp_variable_pay (employee_row_id, kind, amount, amount_type, period, is_proposed) VALUES (?, ?, ?, ?, ?, ?)',
    [employeeId, data.kind, Number(data.amount), data.amountType === 'percent' ? 'percent' : 'sum', data.period || null, data.isProposed ? 1 : 0]);
  return getRequest(row.request_id);
}

async function removeVariablePay(variablePayId) {
  const row = await queryOne('SELECT * FROM comp_variable_pay WHERE id = ?', [variablePayId]);
  if (!row) throw new CompReviewError('Строка не найдена');
  const empRow = await requireEmployeeInDraft(row.employee_row_id);
  await run('DELETE FROM comp_variable_pay WHERE id = ?', [variablePayId]);
  return getRequest(empRow.request_id);
}

async function deleteDraft(id, actorLogin) {
  const r = await requireDraft(id);
  if (r.initiator_login !== actorLogin) throw new CompReviewError('Удалить черновик может только его автор');
  const employees = await queryAll('SELECT id FROM comp_request_employees WHERE request_id = ?', [id]);
  for (const e of employees) await run('DELETE FROM comp_variable_pay WHERE employee_row_id = ?', [e.id]);
  await run('DELETE FROM comp_request_employees WHERE request_id = ?', [id]);
  await run('DELETE FROM comp_activity WHERE request_id = ?', [id]);
  await run('DELETE FROM comp_requests WHERE id = ?', [id]);
  return { ok: true };
}

async function submitDraft(id, actorLogin) {
  const r = await requireDraft(id);
  const employees = await queryAll('SELECT * FROM comp_request_employees WHERE request_id = ?', [id]);
  if (!employees.length) throw new CompReviewError('В заявке нет ни одного сотрудника');
  for (const e of employees) {
    const elig = checkEligibility({ lastReviewDate: e.last_review_date, reasonCode: e.reason_code, reasonText: e.reason_text });
    if (!elig.eligible) throw new CompReviewError(`${e.fio}: ${elig.reason}`);

    // Предлагаемый оклад совпадает с текущим — реального изменения нет, если
    // только его не даёт переменная часть (§3: «Предлагаемые изменения
    // переменной части»). Без этой проверки заявка могла уйти на согласование
    // без единого фактического изменения.
    if (e.current_salary != null && Number(e.proposed_salary) === Number(e.current_salary)) {
      const proposedVp = await queryOne(
        'SELECT 1 FROM comp_variable_pay WHERE employee_row_id = ? AND is_proposed = 1 LIMIT 1', [e.id]);
      if (!proposedVp) {
        throw new CompReviewError(
          `${e.fio}: предлагаемый оклад совпадает с текущим — добавьте изменение переменной части или укажите другой оклад`);
      }
    }
  }
  await run("UPDATE comp_requests SET status = 'cb_review', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
  await logActivity(id, null, actorLogin, 'отправил на проверку C&B', null);
  return getRequest(id);
}

// ─── C&B ───

function requireStatus(row, status, label) {
  if (row.status !== status) throw new CompReviewError(`Заявка сейчас не на этапе «${label}»`);
}

async function cbSetMarketData(employeeId, { marketMin, marketMedian, marketMax } = {}, user) {
  const row = await queryOne('SELECT * FROM comp_request_employees WHERE id = ?', [employeeId]);
  if (!row) throw new CompReviewError('Сотрудник не найден в заявке');
  const req = await getRequestRow(row.request_id);
  requireStatus(req, 'cb_review', 'проверка C&B');

  let median = marketMedian != null ? Number(marketMedian) : null;
  if (median == null) median = await fetchMarketMedian(row.position, user);
  const min = marketMin != null ? Number(marketMin) : null;
  const max = marketMax != null ? Number(marketMax) : null;
  await run('UPDATE comp_request_employees SET market_min = ?, market_median = ?, market_max = ? WHERE id = ?', [min, median, max, employeeId]);
  await touchRequest(req.id);
  return getRequest(req.id);
}

async function cbReturn(id, comment, actorLogin) {
  const r = await getRequestRow(id);
  requireStatus(r, 'cb_review', 'проверка C&B');
  if (!String(comment || '').trim()) throw new CompReviewError('Возврат на доработку требует комментария');
  await run("UPDATE comp_requests SET status = 'draft', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
  await logActivity(id, null, actorLogin, 'вернул на доработку', comment);
  return getRequest(id);
}

async function cbForward(id, actorLogin) {
  const r = await getRequestRow(id);
  requireStatus(r, 'cb_review', 'проверка C&B');
  await run("UPDATE comp_requests SET status = 'hrd_review', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
  await logActivity(id, null, actorLogin, 'передал на согласование HRD', null);
  return getRequest(id);
}

// ─── HRD ───

async function hrdApprove(id, actorLogin) {
  const r = await getRequestRow(id);
  requireStatus(r, 'hrd_review', 'согласование HRD');
  const next = nextStatusAfterHrd(r.request_type);

  if (next === 'committee') {
    const members = await queryAll('SELECT user_login FROM comp_committee_members ORDER BY user_login');
    const snapshot = members.map(m => m.user_login);
    await run("UPDATE comp_requests SET status = 'committee', committee_snapshot = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [JSON.stringify(snapshot), id]);
    await logActivity(id, null, actorLogin, 'согласовал, направил на голосование комиссии', null);
  } else {
    // «Выход из стажировки» — комиссия не голосует, решение HRD — финальное по каждому сотруднику.
    await run("UPDATE comp_requests SET status = 'payroll', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
    await run("UPDATE comp_request_employees SET status = 'approved_awaiting_payroll', decided_at = CURRENT_TIMESTAMP WHERE request_id = ?", [id]);
    await logActivity(id, null, actorLogin, 'согласовал (стажировка — без голосования комиссии), направил кадровику', null);
  }
  return getRequest(id);
}

async function hrdReject(id, comment, actorLogin) {
  const r = await getRequestRow(id);
  requireStatus(r, 'hrd_review', 'согласование HRD');
  if (!String(comment || '').trim()) throw new CompReviewError('Отклонение требует комментария');
  await run("UPDATE comp_requests SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
  await run("UPDATE comp_request_employees SET status = 'rejected_hrd', decided_at = CURRENT_TIMESTAMP WHERE request_id = ?", [id]);
  await logActivity(id, null, actorLogin, 'отклонил заявку', comment);
  return getRequest(id);
}

// ─── Комиссия ───

/**
 * Заявка закрывается, когда по каждому сотруднику есть финальное решение
 * (§2) — «финальное» для кадровика означает «внесено» (done), не просто
 * «одобрено комиссией» (approved_awaiting_payroll — тот ещё ждёт кадровика,
 * заявка остаётся на этапе payroll).
 */
async function closeRequestIfAllDecided(requestId) {
  const employees = await queryAll('SELECT status FROM comp_request_employees WHERE request_id = ?', [requestId]);
  if (employees.some(e => e.status === 'active')) return;
  const awaitingPayroll = employees.some(e => e.status === 'approved_awaiting_payroll');
  await run("UPDATE comp_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [awaitingPayroll ? 'payroll' : 'closed', requestId]);
}

async function finalizeEmployeeCommitteeDecision(employeeRow, outcome, actorLogin, note) {
  const status = outcome === 'approved' ? 'approved_awaiting_payroll' : 'rejected_committee';
  await run("UPDATE comp_request_employees SET status = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?", [status, employeeRow.id]);
  await logActivity(employeeRow.request_id, employeeRow.id, actorLogin,
    outcome === 'approved' ? 'комиссия одобрила' : 'комиссия отклонила', note || null);
  await closeRequestIfAllDecided(employeeRow.request_id);
}

async function vote(employeeId, { vote: decision, comment }, actorLogin) {
  if (!['for', 'against'].includes(decision)) throw new CompReviewError('Некорректный голос');
  const row = await queryOne('SELECT * FROM comp_request_employees WHERE id = ?', [employeeId]);
  if (!row) throw new CompReviewError('Сотрудник не найден в заявке');
  const req = await getRequestRow(row.request_id);
  requireStatus(req, 'committee', 'голосование комиссии');
  if (row.status !== 'active') throw new CompReviewError('По этому сотруднику итог уже подведён');

  const snapshot = JSON.parse(req.committee_snapshot || '[]');
  if (!snapshot.includes(actorLogin)) throw new CompReviewError('Вы не входите в состав комиссии по этой заявке');

  await run(
    `INSERT INTO comp_committee_votes (employee_row_id, voter_login, vote, comment) VALUES (?, ?, ?, ?)
     ON CONFLICT(employee_row_id, voter_login) DO UPDATE SET vote = excluded.vote, comment = excluded.comment, voted_at = CURRENT_TIMESTAMP`,
    [employeeId, actorLogin, decision, comment || null]);

  const votes = await queryAll('SELECT voter_login, vote FROM comp_committee_votes WHERE employee_row_id = ?', [employeeId]);
  const outcome = committeeOutcome(snapshot, votes);
  if (outcome !== 'pending') await finalizeEmployeeCommitteeDecision(row, outcome, actorLogin, comment);
  return getRequest(row.request_id, actorLogin);
}

async function forceDecide(employeeId, decision, actorLogin) {
  if (!['approved', 'rejected'].includes(decision)) throw new CompReviewError('Некорректное решение');
  const row = await queryOne('SELECT * FROM comp_request_employees WHERE id = ?', [employeeId]);
  if (!row) throw new CompReviewError('Сотрудник не найден в заявке');
  const req = await getRequestRow(row.request_id);
  requireStatus(req, 'committee', 'голосование комиссии');
  if (row.status !== 'active') throw new CompReviewError('По этому сотруднику итог уже подведён');
  await finalizeEmployeeCommitteeDecision(row, decision, actorLogin, 'принудительное решение администратора');
  return getRequest(row.request_id);
}

/** Кто из зафиксированного состава ещё не проголосовал по сотруднику (для C&B/админа и для напоминаний). */
async function pendingVoters(employeeId) {
  const row = await queryOne('SELECT * FROM comp_request_employees WHERE id = ?', [employeeId]);
  if (!row) return [];
  const req = await getRequestRow(row.request_id);
  if (req.status !== 'committee' || row.status !== 'active') return [];
  const snapshot = JSON.parse(req.committee_snapshot || '[]');
  const votes = await queryAll('SELECT voter_login FROM comp_committee_votes WHERE employee_row_id = ?', [employeeId]);
  const voted = new Set(votes.map(v => v.voter_login));
  return snapshot.filter(login => !voted.has(login));
}

/**
 * Ручная кнопка «Напомнить» (§5 — доступна C&B). Автоматическое напоминание
 * раз в 3 дня без движения дёргается ежедневным Vercel Cron — см.
 * remindStaleCommitteeVotes ниже, вызывается из того же runDaily.
 */
async function remindVoters(employeeId, actorLogin) {
  const pending = await pendingVoters(employeeId);
  if (!pending.length) return { ok: true, remindedCount: 0 };
  const row = await queryOne('SELECT * FROM comp_request_employees WHERE id = ?', [employeeId]);
  const placeholders = pending.map(() => '?').join(',');
  const users = await queryAll(`SELECT login, telegram_chat_id FROM users WHERE login IN (${placeholders})`, pending);
  let sent = 0;
  for (const u of users) {
    if (!u.telegram_chat_id) continue;
    const ok = await sendTelegramMessage(u.telegram_chat_id, `Напоминание: ждём ваш голос по пересмотру ЗП — «${row.fio}» (заявка #${row.request_id}).`);
    if (ok) sent++;
  }
  await logActivity(row.request_id, row.id, actorLogin, 'напоминание комиссии', `${sent} из ${pending.length}`);
  return { ok: true, remindedCount: sent };
}

/** Раз в сутки — кто висит в голосовании ≥3 дня без движения (используется дневным cron'ом). */
async function remindStaleCommitteeVotes() {
  const rows = await queryAll(
    `SELECT e.* FROM comp_request_employees e
     JOIN comp_requests r ON r.id = e.request_id
     WHERE r.status = 'committee' AND e.status = 'active'`);
  let requestsChecked = 0;
  let remindersSent = 0;
  for (const row of rows) {
    const req = await getRequestRow(row.request_id);
    const daysSince = Math.floor((Date.now() - Date.parse(req.updated_at.replace(' ', 'T') + 'Z')) / 86400000);
    if (daysSince > 0 && daysSince % 3 === 0) {
      const r = await remindVoters(row.id, 'cron');
      remindersSent += r.remindedCount;
    }
    requestsChecked++;
  }
  return { ok: true, requestsChecked, remindersSent };
}

// ─── Кадровик ───

async function markPayrollEntered(employeeId, actorLogin, { comment, effectiveDate } = {}) {
  const row = await queryOne('SELECT * FROM comp_request_employees WHERE id = ?', [employeeId]);
  if (!row) throw new CompReviewError('Сотрудник не найден в заявке');
  if (row.status !== 'approved_awaiting_payroll') throw new CompReviewError('Изменение ещё не одобрено или уже внесено');
  const req = await getRequestRow(row.request_id);
  const enteredDate = effectiveDate || req.effective_date;

  await run(
    "UPDATE comp_request_employees SET status = 'done', payroll_entered_at = CURRENT_TIMESTAMP, payroll_entered_by = ?, payroll_comment = ?, payroll_effective_date = ? WHERE id = ?",
    [actorLogin, comment || null, enteredDate || null, employeeId]);
  await run(
    'INSERT INTO comp_review_history (unit, fio, effective_date, new_salary, request_id) VALUES (?, ?, ?, ?, ?)',
    [row.unit, row.fio, enteredDate, row.proposed_salary, req.id]);
  await logActivity(req.id, row.id, actorLogin, 'внесено в 1С', comment || null);
  await closeRequestIfAllDecided(req.id);
  return getRequest(req.id);
}

// ─── Вложения (через Telegram-бота) ───

const ATTACH_TOKEN_TTL_MINUTES = 15;
const MAX_ATTACHMENTS_PER_EMPLOYEE = 10;
const MAX_ATTACHMENT_BYTES = 19 * 1024 * 1024; // getFile Bot API сам не отдаёт файлы тяжелее ~20 МБ

async function requireEmployeeVisible(employeeId, user, hasCap) {
  const row = await queryOne('SELECT * FROM comp_request_employees WHERE id = ?', [employeeId]);
  if (!row) throw new CompReviewError('Сотрудник не найден в заявке');
  const req = await getRequestRow(row.request_id);
  if (!(await canView(mapRequest(req), user, hasCap))) throw new CompReviewError('Недостаточно прав');
  return row;
}

/** Кнопка «Прикрепить через Telegram» — одноразовая ссылка на бота (`/start att_<token>`),
 *  живёт ATTACH_TOKEN_TTL_MINUTES минут; всё, что боту пришлют в этом чате за это
 *  время документом, уйдёт именно этому сотруднику этой заявки (см. handleDocument
 *  в telegramController). */
async function createAttachToken(employeeId, user, hasCap) {
  const row = await requireEmployeeVisible(employeeId, user, hasCap);
  const count = await queryOne('SELECT COUNT(*) AS n FROM comp_attachments WHERE employee_row_id = ?', [employeeId]);
  const current = Number(count.n);
  if (current >= MAX_ATTACHMENTS_PER_EMPLOYEE) {
    throw new CompReviewError(`У сотрудника уже максимум файлов (${MAX_ATTACHMENTS_PER_EMPLOYEE})`);
  }

  const username = await getBotUsername();
  if (!username) throw new CompReviewError('Telegram-бот не подключён');

  const token = crypto.randomBytes(16).toString('hex');
  await run(
    `INSERT INTO comp_attach_tokens (token, request_id, employee_row_id, created_by_login, expires_at)
     VALUES (?, ?, ?, ?, datetime('now', '+${ATTACH_TOKEN_TTL_MINUTES} minutes'))`,
    [token, row.request_id, employeeId, user.login]);

  return {
    deepLink: `https://t.me/${username}?start=att_${token}`,
    expiresInMinutes: ATTACH_TOKEN_TTL_MINUTES,
    remaining: MAX_ATTACHMENTS_PER_EMPLOYEE - current
  };
}

/** Найти активный (непросроченный) attach-токен, привязанный к этому Telegram-чату —
 *  вызывается telegramController'ом, когда в чат приходит документ. */
async function findActiveAttachTokenByChat(chatId) {
  return queryOne(
    "SELECT * FROM comp_attach_tokens WHERE chat_id = ? AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1",
    [String(chatId)]);
}

/** Помечает токен как «привязан к этому чату» после /start att_<token> — до этого
 *  момента полученный токен ещё ничей чат не занял. */
async function claimAttachToken(token, chatId) {
  const row = await queryOne("SELECT * FROM comp_attach_tokens WHERE token = ? AND expires_at > datetime('now')", [token]);
  if (!row) return null;
  await run('UPDATE comp_attach_tokens SET chat_id = ? WHERE token = ?', [String(chatId), token]);
  const emp = await queryOne('SELECT fio FROM comp_request_employees WHERE id = ?', [row.employee_row_id]);
  return { ...row, fio: emp ? emp.fio : '' };
}

/** Сохраняет файл, присланный в Telegram, как вложение сотрудника — см. handleDocument
 *  в telegramController (chat уже привязан токеном к employeeRowId/requestId). */
async function saveAttachmentFromTelegram(tokenRow, doc) {
  const { employee_row_id: employeeRowId, request_id: requestId, created_by_login: actorLogin } = tokenRow;
  const count = await queryOne('SELECT COUNT(*) AS n FROM comp_attachments WHERE employee_row_id = ?', [employeeRowId]);
  const current = Number(count.n);
  if (current >= MAX_ATTACHMENTS_PER_EMPLOYEE) {
    throw new CompReviewError(`Уже прикреплено максимум файлов (${MAX_ATTACHMENTS_PER_EMPLOYEE})`);
  }
  if (doc.file_size && doc.file_size > MAX_ATTACHMENT_BYTES) {
    throw new CompReviewError('Файл слишком большой — Telegram отдаёт ботам файлы не тяжелее ~19 МБ');
  }

  const data = await downloadTelegramFile(doc.file_id);
  const fileName = doc.file_name || 'файл';
  await run(
    'INSERT INTO comp_attachments (request_id, employee_row_id, file_name, mime_type, size_bytes, data) VALUES (?, ?, ?, ?, ?, ?)',
    [requestId, employeeRowId, fileName, doc.mime_type || null, data.length, data]);
  await logActivity(requestId, employeeRowId, actorLogin, 'прикрепил файл через Telegram', fileName);

  return { fileName, count: current + 1, max: MAX_ATTACHMENTS_PER_EMPLOYEE };
}

function mapAttachment(a) {
  return { id: a.id, fileName: a.file_name, mimeType: a.mime_type, sizeBytes: a.size_bytes, createdAt: a.created_at };
}

async function listAttachments(employeeId, user, hasCap) {
  await requireEmployeeVisible(employeeId, user, hasCap);
  const rows = await queryAll(
    'SELECT id, file_name, mime_type, size_bytes, created_at FROM comp_attachments WHERE employee_row_id = ? ORDER BY id', [employeeId]);
  return rows.map(mapAttachment);
}

async function getAttachmentForDownload(attachmentId, user, hasCap) {
  const a = await queryOne('SELECT * FROM comp_attachments WHERE id = ?', [attachmentId]);
  if (!a) throw new CompReviewError('Файл не найден');
  const req = await getRequestRow(a.request_id);
  if (!(await canView(mapRequest(req), user, hasCap))) throw new CompReviewError('Недостаточно прав');
  return a;
}

async function removeAttachment(attachmentId, actorLogin) {
  const a = await queryOne('SELECT * FROM comp_attachments WHERE id = ?', [attachmentId]);
  if (!a) throw new CompReviewError('Файл не найден');
  await requireDraft(a.request_id);
  await run('DELETE FROM comp_attachments WHERE id = ?', [attachmentId]);
  await logActivity(a.request_id, a.employee_row_id, actorLogin, 'удалил файл', a.file_name);
  return { ok: true };
}

// ─── Реестр, видимость, комментарии ───

async function canView(request, user, hasCap) {
  if (user.role === 'admin') return true;
  if (request.initiatorLogin === user.login) return true;
  if (await hasCap('comp:review_cb')) return true;
  if (await hasCap('comp:admin')) return true;
  if (request.status === 'hrd_review' && await hasCap('comp:approve_hrd')) return true;
  if (request.status === 'committee') {
    const req = await getRequestRow(request.id);
    const snapshot = JSON.parse(req.committee_snapshot || '[]');
    if (snapshot.includes(user.login)) return true;
  }
  if ((request.status === 'payroll' || request.status === 'closed') && await hasCap('comp:payroll')) {
    // Заявка могла закрыться сразу после комиссии, минуя статус «у
    // кадровика» (единственный сотрудник — и тот отклонён, closeRequestIfAllDecided
    // ставит 'closed' напрямую). Кадровик должен видеть и такой исход —
    // иначе отклонённый комиссией сотрудник для него просто пропадает без следа.
    const reachedCommittee = await queryOne(
      "SELECT 1 FROM comp_request_employees WHERE request_id = ? AND status IN ('done','approved_awaiting_payroll','rejected_committee') LIMIT 1",
      [request.id]);
    if (reachedCommittee) return true;
  }
  const touched = await queryOne('SELECT 1 FROM comp_activity WHERE request_id = ? AND actor_login = ? LIMIT 1', [request.id, user.login]);
  return !!touched;
}

/** Реестр (§6): «Ждут меня» зависит от прав вошедшего, «Мои» — по initiator_login, «Все актуальные»/«Закрытые» — по статусу. */
async function listRequests({ tab, user, hasCap }) {
  let rows;
  if (tab === 'mine') {
    rows = await queryAll('SELECT * FROM comp_requests WHERE initiator_login = ? ORDER BY updated_at DESC', [user.login]);
  } else if (tab === 'closed') {
    rows = await queryAll("SELECT * FROM comp_requests WHERE status = 'closed' ORDER BY updated_at DESC LIMIT 200");
  } else if (tab === 'waiting') {
    const candidates = await queryAll("SELECT * FROM comp_requests WHERE status != 'closed' ORDER BY updated_at DESC");
    const mine = [];
    for (const r of candidates) {
      const mapped = mapRequest(r);
      if (await isActionableByMe(mapped, user, hasCap)) mine.push(r);
    }
    rows = mine;
  } else {
    // 'all' — все актуальные (не закрытые); кадровик реестр всё равно сузит правами на маршруте.
    rows = await queryAll("SELECT * FROM comp_requests WHERE status != 'closed' ORDER BY updated_at DESC LIMIT 200");
  }
  const visible = [];
  for (const r of rows) {
    const mapped = mapRequest(r);
    if (await canView(mapped, user, hasCap)) visible.push(mapped);
  }
  return visible;
}

async function isActionableByMe(request, user, hasCap) {
  if (request.status === 'cb_review' && await hasCap('comp:review_cb')) return true;
  if (request.status === 'hrd_review' && await hasCap('comp:approve_hrd')) return true;
  if (request.status === 'committee') {
    const req = await getRequestRow(request.id);
    const snapshot = JSON.parse(req.committee_snapshot || '[]');
    if (snapshot.includes(user.login)) {
      const pendingCount = await queryOne(
        "SELECT COUNT(*) AS n FROM comp_request_employees e WHERE e.request_id = ? AND e.status = 'active' AND NOT EXISTS (SELECT 1 FROM comp_committee_votes v WHERE v.employee_row_id = e.id AND v.voter_login = ?)",
        [request.id, user.login]);
      if (pendingCount && Number(pendingCount.n) > 0) return true;
    }
  }
  if (request.status === 'payroll' && await hasCap('comp:payroll')) {
    const pendingCount = await queryOne("SELECT COUNT(*) AS n FROM comp_request_employees WHERE request_id = ? AND status = 'approved_awaiting_payroll'", [request.id]);
    if (pendingCount && Number(pendingCount.n) > 0) return true;
  }
  return false;
}

async function addComment(requestId, comment, actorLogin) {
  if (!String(comment || '').trim()) throw new CompReviewError('Пустой комментарий');
  await getRequestRow(requestId);
  await logActivity(requestId, null, actorLogin, 'комментарий', comment.trim());
  return getRequest(requestId, actorLogin);
}

// ─── Комиссия (состав) и настройки ───

async function listCommitteeMembers() {
  const rows = await queryAll('SELECT user_login FROM comp_committee_members ORDER BY user_login');
  return rows.map(r => r.user_login);
}
async function addCommitteeMember(login) { await run('INSERT OR IGNORE INTO comp_committee_members (user_login) VALUES (?)', [login]); }
async function removeCommitteeMember(login) { await run('DELETE FROM comp_committee_members WHERE user_login = ?', [login]); }

async function getSettings() {
  const row = await queryOne('SELECT vote_mode FROM comp_settings WHERE id = 1');
  return { voteMode: row ? row.vote_mode : 'closed' };
}
async function saveSettings(voteMode) {
  if (!['open', 'closed'].includes(voteMode)) throw new CompReviewError('Некорректный режим голосования');
  await run('UPDATE comp_settings SET vote_mode = ? WHERE id = 1', [voteMode]);
  return getSettings();
}

async function listVariablePayKinds() {
  const rows = await queryAll('SELECT label FROM comp_variable_pay_kinds WHERE active = 1 ORDER BY id');
  return rows.map(r => r.label);
}

module.exports = {
  REQUEST_TYPES, REASON_CODES,
  employeeOptions, positionOptions, listVariablePayKinds, getSettings, saveSettings,
  listCommitteeMembers, addCommitteeMember, removeCommitteeMember,
  createDraft, updateDraftHeader, addEmployee, updateEmployee, removeEmployee,
  addVariablePay, removeVariablePay, deleteDraft, submitDraft,
  cbSetMarketData, cbReturn, cbForward, hrdApprove, hrdReject,
  vote, forceDecide, pendingVoters, remindVoters, remindStaleCommitteeVotes, markPayrollEntered,
  getRequest, listRequests, canView, addComment,
  createAttachToken, findActiveAttachTokenByChat, claimAttachToken, saveAttachmentFromTelegram,
  listAttachments, getAttachmentForDownload, removeAttachment
};
