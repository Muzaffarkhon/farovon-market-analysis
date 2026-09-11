const { queryAll, queryOne, run } = require('../db/database');
const {
  GROUPS, GROUP_KEYS, GRADE_THRESHOLDS, RISK_FACTOR_FIELDS, RISK_LEVELS,
  GradingError, normalizeGroup, evaluatePosition, evaluateRisk
} = require('../services/gradingService');
const factorsService = require('../services/gradingFactorsService');

/**
 * Грейдирование должностей и матрица рисков незаменимости персонала.
 *
 * Вся математика живёт в services/gradingService.js — здесь только доступ к
 * данным, права и границы видимости. Оценка должности привязана к паре
 * «подразделение + должность» (одна актуальная строка, повторная оценка
 * перезаписывает прошлую), анкета риска — к паре «сотрудник + должность»
 * внутри подразделения.
 *
 * Видимость: admin и cb видят весь холдинг, остальные — только закреплённые
 * за ними подразделения (users.units), тем же правилом, что и анкеты
 * (см. authController.getUserPayload). Анкеты рисков содержат ФИО живых
 * сотрудников, поэтому выдача чужого подразделения закрыта и на чтении, и
 * на записи.
 */

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const MAX_TEXT = 2000;

/** null — «без ограничения» (admin/cb), иначе список закреплённых подразделений. */
function allowedUnits(user) {
  if (user.role === 'admin' || user.role === 'cb') return null;
  return Array.isArray(user.units) ? user.units : [];
}

function canUseUnit(user, unit) {
  const allowed = allowedUnits(user);
  if (allowed === null) return true;
  return allowed.includes(unit);
}

/** WHERE-кусок «только мои подразделения» + аргументы к нему. */
function unitScopeSql(user, column) {
  const allowed = allowedUnits(user);
  if (allowed === null) return { sql: '', args: [] };
  if (!allowed.length) return { sql: ' AND 1 = 0', args: [] };
  return {
    sql: ` AND ${column} IN (${allowed.map(() => '?').join(',')})`,
    args: allowed.slice()
  };
}

function readLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function readText(raw, max = MAX_TEXT) {
  return String(raw == null ? '' : raw).trim().slice(0, max);
}

function fail(res, message, status = 400) {
  return res.status(status).json({ ok: false, error: message, message });
}

/** Ошибку валидации анкеты показываем пользователю, всё остальное — 500 в лог. */
function handleError(res, err, where) {
  if (err instanceof GradingError) return fail(res, err.message);
  console.error(`${where} error:`, err.message);
  return fail(res, 'Не удалось выполнить операцию, попробуйте ещё раз', 500);
}

/**
 * Тексты анкет: формулировки факторов, веса и расшифровка баллов 1–5.
 * Отдельным запросом, а не внутри каждой выдачи должностей, — справочник
 * статичный, клиент забирает его один раз при открытии раздела.
 * Формулировки берутся из базы (их правит C&B в админке), веса и пороги —
 * из кода: от них зависит расчёт балла.
 */
async function getFactors(req, res) {
  try {
    const texts = await factorsService.getFactors();
    return res.json({
      ok: true,
      source: texts.source,
      groups: GROUP_KEYS.map(key => ({
        key,
        label: GROUPS[key].label,
        weights: GROUPS[key].weights,
        factors: texts.groups[key]
      })),
      grades: GRADE_THRESHOLDS,
      riskFactors: texts.risk,
      riskLevels: RISK_LEVELS.map(l => ({ status: l.status, label: l.label, max: l.max, recommendation: l.recommendation }))
    });
  } catch (err) {
    return handleError(res, err, 'getFactors');
  }
}

/** Правка формулировки вопроса анкеты (админка → «Анкеты оценки»). */
async function saveFactor(req, res) {
  try {
    const body = req.body || {};
    const saved = await factorsService.saveFactor({
      scope: body.scope,
      idx: body.idx,
      title: body.title,
      help: body.help,
      options: body.options,
      updatedBy: req.user.fio || req.user.login
    });

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'правка анкеты оценки',
      `${saved.scope} №${saved.idx}: «${saved.title}»`
    ]);

    return res.json({ ok: true, message: 'Формулировка сохранена' });
  } catch (err) {
    return handleError(res, err, 'saveFactor');
  }
}

/** Возврат вопроса к исходной формулировке из Google-формы. */
async function resetFactor(req, res) {
  try {
    const body = req.body || {};
    const saved = await factorsService.resetFactor(
      String(body.scope || ''), parseInt(body.idx, 10), req.user.fio || req.user.login
    );

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'возврат анкеты оценки к исходной',
      `${saved.scope} №${saved.idx}`
    ]);

    return res.json({ ok: true, message: 'Восстановлена исходная формулировка' });
  } catch (err) {
    return handleError(res, err, 'resetFactor');
  }
}

// ─── Грейдирование должностей ───

/**
 * Реестр должностей подразделения: штатные позиции (unit_positions) вместе с
 * уже проставленным грейдом. Должности без оценки тоже отдаём — иначе
 * непонятно, что ещё предстоит оценить.
 */
async function getPositions(req, res) {
  try {
    const unit = readText(req.query.unit, 300);
    const limit = readLimit(req.query.limit);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    if (unit && !canUseUnit(req.user, unit)) {
      return fail(res, 'Это подразделение вам не назначено', 403);
    }

    const scope = unitScopeSql(req.user, 'p.unit');
    const args = [];
    let where = 'WHERE 1 = 1';
    if (unit) {
      where += ' AND p.unit = ?';
      args.push(unit);
    }
    where += scope.sql;
    args.push(...scope.args);

    const rows = await queryAll(`
      SELECT p.unit, p.position AS job_title, p.staff_count,
             e.id AS evaluation_id, e.group_type, e.factor_1, e.factor_2, e.factor_3, e.factor_4,
             e.weighted_score, e.grade_level, e.evaluated_by, e.notes, e.updated_at
      FROM unit_positions p
      LEFT JOIN job_evaluations e ON e.unit = p.unit AND e.job_title = p.position
      ${where}
      ORDER BY p.unit ASC, p.position ASC
      LIMIT ? OFFSET ?
    `, [...args, limit, offset]);

    return res.json({
      ok: true,
      groups: GROUP_KEYS.map(key => ({ key, label: GROUPS[key].label, factors: GROUPS[key].weights.length })),
      rows,
      limit,
      offset
    });
  } catch (err) {
    return handleError(res, err, 'getPositions');
  }
}

/** Сохранение оценки комиссии по должности (повторная — перезапись прошлой). */
async function evaluate(req, res) {
  try {
    const unit = readText(req.body && req.body.unit, 300);
    const jobTitle = readText(req.body && req.body.job_title, 300);
    const groupType = normalizeGroup(req.body && req.body.group_type);
    const notes = readText(req.body && req.body.notes);
    const factors = (req.body && req.body.factors) || [];

    if (!unit || !jobTitle) return fail(res, 'Укажите подразделение и должность');
    if (!canUseUnit(req.user, unit)) return fail(res, 'Это подразделение вам не назначено', 403);

    const result = evaluatePosition(groupType, factors);
    // У трёхфакторных групп четвёртой оценки нет — в базе это NULL, а не 0.
    const [f1, f2, f3] = result.factors;
    const f4 = result.factors.length > 3 ? result.factors[3] : null;

    await run(`
      INSERT INTO job_evaluations
        (unit, job_title, group_type, factor_1, factor_2, factor_3, factor_4,
         weighted_score, grade_level, evaluated_by, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(unit, job_title) DO UPDATE SET
        group_type = excluded.group_type,
        factor_1 = excluded.factor_1,
        factor_2 = excluded.factor_2,
        factor_3 = excluded.factor_3,
        factor_4 = excluded.factor_4,
        weighted_score = excluded.weighted_score,
        grade_level = excluded.grade_level,
        evaluated_by = excluded.evaluated_by,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
    `, [
      unit, jobTitle, result.groupType, f1, f2, f3, f4,
      result.weightedScore, result.gradeLevel, req.user.fio || req.user.login, notes || null
    ]);

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'грейдирование должности',
      `${unit} / ${jobTitle}: балл ${result.weightedScore}, уровень ${result.gradeLevel}`
    ]);

    return res.json({ ok: true, ...result, message: 'Оценка сохранена' });
  } catch (err) {
    return handleError(res, err, 'evaluate');
  }
}

/** Сводка: сколько должностей на каждом уровне, в разрезе групп. */
async function getStats(req, res) {
  try {
    const scope = unitScopeSql(req.user, 'unit');
    const rows = await queryAll(`
      SELECT group_type, grade_level, COUNT(*) AS n
      FROM job_evaluations
      WHERE 1 = 1${scope.sql}
      GROUP BY group_type, grade_level
      ORDER BY group_type ASC, grade_level ASC
    `, scope.args);

    const total = rows.reduce((sum, r) => sum + Number(r.n || 0), 0);
    return res.json({ ok: true, total, rows });
  } catch (err) {
    return handleError(res, err, 'getStats');
  }
}

// ─── Риски незаменимости ключевого персонала ───

async function listRisks(req, res) {
  try {
    const unit = readText(req.query.unit, 300);
    const status = readText(req.query.status, 30);
    const limit = readLimit(req.query.limit);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    if (unit && !canUseUnit(req.user, unit)) {
      return fail(res, 'Это подразделение вам не назначено', 403);
    }
    if (status && !RISK_LEVELS.some(l => l.status === status)) {
      return fail(res, 'Неизвестный статус риска');
    }

    const scope = unitScopeSql(req.user, 'r.unit');
    const args = [];
    let where = 'WHERE 1 = 1';
    if (unit) { where += ' AND r.unit = ?'; args.push(unit); }
    if (status) { where += ' AND r.risk_status = ?'; args.push(status); }
    where += scope.sql;
    args.push(...scope.args);

    const rows = await queryAll(`
      SELECT r.id, r.unit, r.employee_fio, r.job_title,
             r.bus_factor, r.replacement_time, r.knowledge_monopoly, r.financial_risk,
             r.total_risk_score, r.risk_status, r.action_plan, r.evaluator_fio, r.updated_at
      FROM key_personnel_risks r
      ${where}
      ORDER BY r.total_risk_score DESC, r.unit ASC, r.employee_fio ASC
      LIMIT ? OFFSET ?
    `, [...args, limit, offset]);

    return res.json({
      ok: true,
      levels: RISK_LEVELS.map(l => ({ status: l.status, label: l.label, max: l.max })),
      rows,
      limit,
      offset
    });
  } catch (err) {
    return handleError(res, err, 'listRisks');
  }
}

/** Анкета риска по сотруднику (повторная отправка обновляет прошлую). */
async function evaluateRiskCard(req, res) {
  try {
    const body = req.body || {};
    const unit = readText(body.unit, 300);
    const employeeFio = readText(body.employee_fio, 300);
    const jobTitle = readText(body.job_title, 300);

    if (!unit || !employeeFio || !jobTitle) {
      return fail(res, 'Укажите подразделение, ФИО сотрудника и должность');
    }
    if (!canUseUnit(req.user, unit)) return fail(res, 'Это подразделение вам не назначено', 403);

    const result = evaluateRisk(body);
    // Руководитель может расписать своё решение; если поле пустое — берём
    // типовую рекомендацию по уровню риска (колонка NOT NULL по плану).
    const actionPlan = readText(body.action_plan) || result.recommendation;

    await run(`
      INSERT INTO key_personnel_risks
        (unit, employee_fio, job_title, bus_factor, replacement_time, knowledge_monopoly,
         financial_risk, total_risk_score, risk_status, action_plan, evaluator_user_id, evaluator_fio)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(unit, employee_fio, job_title) DO UPDATE SET
        bus_factor = excluded.bus_factor,
        replacement_time = excluded.replacement_time,
        knowledge_monopoly = excluded.knowledge_monopoly,
        financial_risk = excluded.financial_risk,
        total_risk_score = excluded.total_risk_score,
        risk_status = excluded.risk_status,
        action_plan = excluded.action_plan,
        evaluator_user_id = excluded.evaluator_user_id,
        evaluator_fio = excluded.evaluator_fio,
        updated_at = CURRENT_TIMESTAMP
    `, [
      unit, employeeFio, jobTitle,
      result.factors.bus_factor, result.factors.replacement_time,
      result.factors.knowledge_monopoly, result.factors.financial_risk,
      result.totalScore, result.status, actionPlan,
      req.user.id || null, req.user.fio || req.user.login
    ]);

    // В журнал пишем подразделение и должность, без ФИО сотрудника: журнал
    // видят все, у кого есть право на «Сервис и Журнал».
    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'оценка риска незаменимости',
      `${unit} / ${jobTitle}: ${result.totalScore} баллов, статус ${result.statusLabel}`
    ]);

    return res.json({
      ok: true,
      totalScore: result.totalScore,
      status: result.status,
      statusLabel: result.statusLabel,
      actionPlan,
      message: 'Оценка сохранена'
    });
  } catch (err) {
    return handleError(res, err, 'evaluateRiskCard');
  }
}

/** Тепловая карта по направлениям: сколько сотрудников в каком статусе риска. */
async function getHeatmap(req, res) {
  try {
    const scope = unitScopeSql(req.user, 'r.unit');
    const rows = await queryAll(`
      SELECT COALESCE(NULLIF(TRIM(d.dir), ''), '(без направления)') AS dir,
             r.risk_status,
             COUNT(*) AS n
      FROM key_personnel_risks r
      LEFT JOIN divisions d ON d.unit = r.unit
      WHERE 1 = 1${scope.sql}
      GROUP BY dir, r.risk_status
      ORDER BY dir ASC
    `, scope.args);

    // Собираем в строку на направление: клиенту удобнее рисовать готовую сетку.
    const byDir = new Map();
    rows.forEach(r => {
      const entry = byDir.get(r.dir) || { dir: r.dir, standard: 0, attention: 0, critical: 0, total: 0 };
      const n = Number(r.n || 0);
      if (entry[r.risk_status] != null) entry[r.risk_status] += n;
      entry.total += n;
      byDir.set(r.dir, entry);
    });

    return res.json({ ok: true, rows: [...byDir.values()] });
  } catch (err) {
    return handleError(res, err, 'getHeatmap');
  }
}

module.exports = {
  getFactors,
  saveFactor,
  resetFactor,
  getPositions,
  evaluate,
  getStats,
  listRisks,
  evaluateRiskCard,
  getHeatmap,
  // экспортируется для тестов границ видимости
  allowedUnits,
  unitScopeSql,
  RISK_FACTOR_FIELDS
};
