'use strict';

const { hasCapability } = require('../middleware/auth');
const { run } = require('../db/database');
const svc = require('../services/compReviewService');

function fail(res, message, status = 400) {
  return res.status(status).json({ ok: false, error: message, message });
}

function hasCapFor(user) {
  return cap => (user.role === 'admin' ? Promise.resolve(true) : hasCapability(user, cap));
}

async function audit(login, action, detail) {
  await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [login, action, detail]).catch(() => {});
}

function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      fail(res, err.message || 'Не удалось выполнить действие');
    }
  };
}

exports.myAccess = handle(async (req, res) => {
  const hasCap = hasCapFor(req.user);
  const [submit, reviewCb, approveHrd, voteCap, payroll, admin, members] = await Promise.all([
    hasCap('comp:submit'), hasCap('comp:review_cb'), hasCap('comp:approve_hrd'), hasCap('comp:vote'),
    hasCap('comp:payroll'), hasCap('comp:admin'), svc.listCommitteeMembers()
  ]);
  const isCommitteeMember = req.user.role === 'admin' || members.includes(req.user.login);
  res.json({
    ok: true, canSubmit: submit, canReviewCb: reviewCb, canApproveHrd: approveHrd,
    canVoteCap: voteCap, canPayroll: payroll, isAdmin: admin, isCommitteeMember
  });
});

exports.reasons = (req, res) => {
  res.json({
    ok: true,
    requestTypes: Object.entries(svc.REQUEST_TYPES).map(([code, label]) => ({ code, label })),
    reasons: Object.entries(svc.REASON_CODES).map(([code, label]) => ({ code, label }))
  });
};

exports.variablePayKinds = handle(async (req, res) => {
  res.json({ ok: true, kinds: await svc.listVariablePayKinds() });
});

exports.employeeOptions = handle(async (req, res) => {
  res.json({ ok: true, rows: await svc.employeeOptions(req.query.q) });
});

exports.positionOptions = handle(async (req, res) => {
  res.json({ ok: true, rows: await svc.positionOptions() });
});

exports.hrBpOptions = handle(async (req, res) => {
  res.json({ ok: true, rows: await svc.hrBpOptions() });
});

exports.createDraft = handle(async (req, res) => {
  const b = req.body || {};
  const request = await svc.createDraft({
    initiatorLogin: req.user.login, unit: b.unit, requestType: b.requestType,
    effectiveDate: b.effectiveDate, basisDocument: b.basisDocument, comment: b.comment
  });
  res.json({ ok: true, request });
});

async function requireOwnOrAdmin(req, requestId) {
  const request = await svc.getRequest(requestId);
  if (req.user.role !== 'admin' && request.initiatorLogin !== req.user.login) {
    throw new Error('Редактировать заявку может только её автор');
  }
  return request;
}

exports.updateDraft = handle(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b = req.body || {};

  if (b.action === 'addEmployee') {
    await requireOwnOrAdmin(req, id);
    const request = await svc.addEmployee(id, b.employee || {}, req.user.login);
    return res.json({ ok: true, request });
  }
  if (b.action === 'updateEmployee') {
    const request = await svc.updateEmployee(b.employeeId, b.employee || {});
    return res.json({ ok: true, request });
  }
  if (b.action === 'removeEmployee') {
    const request = await svc.removeEmployee(b.employeeId, req.user.login);
    return res.json({ ok: true, request });
  }
  if (b.action === 'addVariablePay') {
    const request = await svc.addVariablePay(b.employeeId, b.variablePay || {});
    return res.json({ ok: true, request });
  }
  if (b.action === 'removeVariablePay') {
    const request = await svc.removeVariablePay(b.variablePayId);
    return res.json({ ok: true, request });
  }

  await requireOwnOrAdmin(req, id);
  const request = await svc.updateDraftHeader(id, b.header || {}, req.user.login);
  res.json({ ok: true, request });
});

exports.submitDraft = handle(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await requireOwnOrAdmin(req, id);
  const request = await svc.submitDraft(id, req.user.login);
  await audit(req.user.login, 'изменение ЗП: подача заявки', `#${id}, сотрудников: ${request.employees.length}`);
  res.json({ ok: true, request });
});

exports.deleteDraft = handle(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await svc.deleteDraft(id, req.user.login);
  res.json({ ok: true });
});

exports.list = handle(async (req, res) => {
  const tab = String(req.query.tab || 'waiting');
  const rows = await svc.listRequests({ tab, user: req.user, hasCap: hasCapFor(req.user) });
  res.json({ ok: true, rows });
});

exports.get = handle(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const request = await svc.getRequest(id, req.user.login);
  if (!(await svc.canView(request, req.user, hasCapFor(req.user)))) return fail(res, 'Недостаточно прав', 403);
  res.json({ ok: true, request });
});

exports.cbReturn = handle(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const request = await svc.cbReturn(id, req.body && req.body.comment, req.user.login);
  await audit(req.user.login, 'изменение ЗП: возврат на доработку', `#${id}`);
  res.json({ ok: true, request });
});

exports.cbForward = handle(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const request = await svc.cbForward(id, req.user.login);
  res.json({ ok: true, request });
});

exports.setMarketData = handle(async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const b = req.body || {};
  const request = await svc.cbSetMarketData(employeeId, {
    marketMin: b.marketMin != null ? Number(b.marketMin) : null,
    marketMedian: b.marketMedian != null ? Number(b.marketMedian) : null,
    marketMax: b.marketMax != null ? Number(b.marketMax) : null
  }, req.user);
  res.json({ ok: true, request });
});

exports.hrdApprove = handle(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const request = await svc.hrdApprove(id, req.user.login);
  await audit(req.user.login, 'изменение ЗП: согласование HRD', `#${id}`);
  res.json({ ok: true, request });
});

exports.hrdReject = handle(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const request = await svc.hrdReject(id, req.body && req.body.comment, req.user.login);
  await audit(req.user.login, 'изменение ЗП: отклонение HRD', `#${id}`);
  res.json({ ok: true, request });
});

exports.vote = handle(async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const request = await svc.vote(employeeId, { vote: req.body && req.body.vote, comment: req.body && req.body.comment }, req.user.login);
  res.json({ ok: true, request });
});

exports.forceDecide = handle(async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const request = await svc.forceDecide(employeeId, req.body && req.body.decision, req.user.login);
  await audit(req.user.login, 'изменение ЗП: принудительное решение комиссии', `employee #${employeeId}`);
  res.json({ ok: true, request });
});

exports.remindVoters = handle(async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const result = await svc.remindVoters(employeeId, req.user.login);
  res.json(result);
});

exports.markPayrollEntered = handle(async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const b = req.body || {};
  const request = await svc.markPayrollEntered(employeeId, req.user.login, { comment: b.comment, effectiveDate: b.effectiveDate });
  await audit(req.user.login, 'изменение ЗП: внесено в 1С', `employee #${employeeId}`);
  res.json({ ok: true, request });
});

exports.addComment = handle(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const request = await svc.addComment(id, req.body && req.body.comment, req.user.login);
  res.json({ ok: true, request });
});

exports.committeeMembers = handle(async (req, res) => {
  res.json({ ok: true, rows: await svc.listCommitteeMembers() });
});
exports.addCommitteeMember = handle(async (req, res) => {
  const login = String(req.body.login || '').trim();
  if (!login) return fail(res, 'Укажите логин');
  await svc.addCommitteeMember(login);
  await audit(req.user.login, 'изменение ЗП: комиссия — добавление', login);
  res.json({ ok: true });
});
exports.removeCommitteeMember = handle(async (req, res) => {
  const login = String(req.body.login || '').trim();
  await svc.removeCommitteeMember(login);
  await audit(req.user.login, 'изменение ЗП: комиссия — удаление', login);
  res.json({ ok: true });
});

exports.createAttachToken = handle(async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const result = await svc.createAttachToken(employeeId, req.user, hasCapFor(req.user));
  res.json({ ok: true, ...result });
});

exports.listAttachments = handle(async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const rows = await svc.listAttachments(employeeId, req.user, hasCapFor(req.user));
  res.json({ ok: true, rows });
});

exports.downloadAttachment = handle(async (req, res) => {
  const id = parseInt(req.params.attachmentId, 10);
  const a = await svc.getAttachmentForDownload(id, req.user, hasCapFor(req.user));
  res.setHeader('Content-Type', a.mime_type || 'application/octet-stream');
  // inline вместо attachment — просмотр во вкладке для PDF/картинок вместо принудительного
  // скачивания; для форматов, которые браузер не умеет отрисовать (Word/Excel), он
  // всё равно скачает файл сам, это уже поведение браузера, а не сервера.
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.file_name || 'file')}`);
  res.send(Buffer.from(a.data));
});

exports.deleteAttachment = handle(async (req, res) => {
  const id = parseInt(req.params.attachmentId, 10);
  await svc.removeAttachment(id, req.user.login);
  res.json({ ok: true });
});

exports.getSettings = handle(async (req, res) => {
  res.json({ ok: true, settings: await svc.getSettings() });
});
exports.saveSettings = handle(async (req, res) => {
  const settings = await svc.saveSettings(req.body && req.body.voteMode);
  await audit(req.user.login, 'изменение ЗП: режим голосования', settings.voteMode);
  res.json({ ok: true, settings });
});
