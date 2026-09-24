'use strict';

/**
 * Заявки на изменение зарплаты. Право решать конкретный шаг проверяет сам
 * контроллер (не requireCapability на маршруте) — у committee нет отдельного
 * права на голосование, только членство в salary_committee_members.
 */

const { run } = require('../db/database');
const { hasCapability } = require('../middleware/auth');
const svc = require('../services/salaryRequestService');

function fail(res, message, status = 400) {
  return res.status(status).json({ ok: false, error: message, message });
}

async function audit(login, action, detail) {
  await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [login, action, detail]).catch(() => {});
}

exports.myAccess = async (req, res) => {
  try {
    const canRequest = req.user.role === 'admin' || (await hasCapability(req.user, 'salary:request'));
    const steps = [];
    for (const step of svc.STEPS) {
      if (await canSeeStep(req.user, step)) steps.push(step);
    }
    res.json({ ok: true, canRequest, steps });
  } catch (err) {
    console.error('salary myAccess error:', err);
    fail(res, 'Не удалось определить доступ', 500);
  }
};

exports.reasons = (req, res) => {
  res.json({ ok: true, reasons: Object.entries(svc.REASON_CODES).map(([code, label]) => ({ code, label })) });
};

exports.employeeOptions = async (req, res) => {
  try {
    const rows = await svc.employeeOptions(req.query.q);
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('salary employeeOptions error:', err);
    fail(res, 'Не удалось загрузить сотрудников', 500);
  }
};

exports.create = async (req, res) => {
  try {
    const b = req.body || {};
    const request = await svc.createRequest({
      unit: b.unit, fio: b.fio, position: b.position,
      proposedSalary: b.proposedSalary, proposedPercent: b.proposedPercent,
      reasons: b.reasons, reasonText: b.reasonText,
      createdBy: req.user.login
    });
    await audit(req.user.login, 'заявка на изменение зарплаты',
      `${request.fio} (${request.unit}): ${request.currentSalary ?? '—'} → ${request.proposedSalary}`);
    res.json({ ok: true, request });
  } catch (err) {
    fail(res, err.message || 'Не удалось создать заявку');
  }
};

/** step в query — какую очередь показать (какую роль представляет вошедший). */
async function canSeeStep(user, step) {
  if (user.role === 'admin') return true;
  if (step === 'cb_manager' || step === 'hrd') return hasCapability(user, svc.STEP_CAPABILITY[step]);
  const members = await svc.listCommitteeMembers();
  return members.includes(user.login);
}

exports.queue = async (req, res) => {
  try {
    const step = String(req.query.step || '');
    if (!svc.STEPS.includes(step)) return fail(res, 'Некорректный шаг');
    if (!(await canSeeStep(req.user, step))) return fail(res, 'Недостаточно прав', 403);
    const rows = await svc.listQueue(step);
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('salary queue error:', err);
    fail(res, 'Не удалось загрузить очередь', 500);
  }
};

exports.list = async (req, res) => {
  try {
    const rows = await svc.listAll({ status: req.query.status || undefined });
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('salary list error:', err);
    fail(res, 'Не удалось загрузить заявки', 500);
  }
};

exports.get = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const request = await svc.getRequest(id);
    if (!request) return fail(res, 'Заявка не найдена', 404);
    const canView = req.user.role === 'admin' || request.createdBy === req.user.login ||
      (await hasCapability(req.user, 'salary:view')) || (await canSeeStep(req.user, request.step));
    if (!canView) return fail(res, 'Недостаточно прав', 403);
    res.json({ ok: true, request });
  } catch (err) {
    console.error('salary get error:', err);
    fail(res, 'Не удалось загрузить заявку', 500);
  }
};

exports.decide = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const step = String(req.body.step || '');
    const decision = String(req.body.decision || '');
    if (!svc.STEPS.includes(step)) return fail(res, 'Некорректный шаг');
    if (!['approved', 'rejected'].includes(decision)) return fail(res, 'Некорректное решение');

    if (!(await canSeeStep(req.user, step))) return fail(res, 'Недостаточно прав для этого шага', 403);

    const request = await svc.decide({ requestId: id, step, approverLogin: req.user.login, decision, comment: req.body.comment });
    await audit(req.user.login, 'заявка на изменение зарплаты: решение',
      `#${id} (${step}): ${decision === 'approved' ? 'согласовано' : 'отклонено'}`);
    res.json({ ok: true, request });
  } catch (err) {
    fail(res, err.message || 'Не удалось сохранить решение');
  }
};

exports.history = async (req, res) => {
  try {
    const rows = await svc.listHistory({ unit: req.query.unit, fio: req.query.fio });
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('salary history error:', err);
    fail(res, 'Не удалось загрузить историю окладов', 500);
  }
};

exports.committeeMembers = async (req, res) => {
  try {
    const rows = await svc.listCommitteeMembers();
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('salary committee list error:', err);
    fail(res, 'Не удалось загрузить состав комиссии', 500);
  }
};

exports.addCommitteeMember = async (req, res) => {
  try {
    const login = String(req.body.login || '').trim();
    if (!login) return fail(res, 'Укажите логин');
    await svc.addCommitteeMember(login);
    await audit(req.user.login, 'комиссия по зарплатным заявкам: добавление', login);
    res.json({ ok: true });
  } catch (err) {
    console.error('salary committee add error:', err);
    fail(res, 'Не удалось добавить', 500);
  }
};

exports.removeCommitteeMember = async (req, res) => {
  try {
    const login = String(req.body.login || '').trim();
    await svc.removeCommitteeMember(login);
    await audit(req.user.login, 'комиссия по зарплатным заявкам: удаление', login);
    res.json({ ok: true });
  } catch (err) {
    console.error('salary committee remove error:', err);
    fail(res, 'Не удалось удалить', 500);
  }
};
