const { queryAll, queryOne, run } = require('../db/database');
const {
  CRITERIA_WEIGHTS, FACTOR_COUNT, MAX_GRADE, GRADE_THRESHOLDS, RISK_FACTOR_FIELDS, RISK_LEVELS,
  GradingError, evaluatePosition, evaluateRisk, calcGrade
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
    const dir = readText(req.query.dir, 300);
    const texts = await factorsService.getFactors(dir);
    return res.json({
      ok: true,
      source: texts.source,
      dir: texts.dir || '',
      overrideDirs: await factorsService.listOverrideDirs(),
      // Единая анкета для всех категорий персонала — один набор факторов,
      // одни веса, одна шкала грейдов на всю компанию.
      criteria: texts.criteria,
      weights: CRITERIA_WEIGHTS,
      maxGrade: MAX_GRADE,
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
      dir: body.dir,
      title: body.title,
      help: body.help,
      options: body.options,
      updatedBy: req.user.fio || req.user.login
    });

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'правка анкеты оценки',
      `${saved.scope} №${saved.idx}${saved.dir ? ' (' + saved.dir + ')' : ' (общая)'}: «${saved.title}»`
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
      String(body.scope || ''), parseInt(body.idx, 10), body.dir, req.user.fio || req.user.login
    );

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      saved.dir ? 'удаление формулировки направления' : 'возврат анкеты оценки к исходной',
      `${saved.scope} №${saved.idx}${saved.dir ? ' (' + saved.dir + ')' : ''}`
    ]);

    return res.json({
      ok: true,
      message: saved.dir
        ? 'Формулировка направления удалена — снова действует общая'
        : 'Восстановлена исходная формулировка'
    });
  } catch (err) {
    return handleError(res, err, 'resetFactor');
  }
}

// ─── Грейдирование должностей ───

/**
 * Индустриальные блоки — точка входа экрана оценки вместо списка
 * подразделений: пользователь выбирает блок («Производство» и т.д.), а не
 * подразделение, потому что одна и та же должность в разных подразделениях
 * блока оценивается один раз, а не заново в каждом.
 */
async function getBlocks(req, res) {
  try {
    const rows = await queryAll(`
      SELECT b.key, b.label, b.sort,
             COUNT(DISTINCT ga.position) AS position_count,
             COUNT(DISTINCT e.job_title) AS evaluated_count
      FROM grading_blocks b
      LEFT JOIN grading_block_assignments ga ON ga.block_key = b.key
      LEFT JOIN job_evaluations e ON e.block_key = b.key AND e.job_title = ga.position
      GROUP BY b.key
      ORDER BY b.sort ASC
    `);
    return res.json({ ok: true, rows });
  } catch (err) {
    return handleError(res, err, 'getBlocks');
  }
}

/**
 * Уникальные должности блока (не подразделения!) вместе с уже проставленным
 * грейдом. Одна и та же «Техничка» в 20 подразделениях блока — одна строка
 * здесь, а не 20: оценивается требование к функции внутри блока один раз.
 */
async function getPositions(req, res) {
  try {
    const block = readText(req.query.block, 100);
    const limit = readLimit(req.query.limit);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    if (!block) return fail(res, 'Укажите блок');
    const blockRow = await queryOne('SELECT key, label FROM grading_blocks WHERE key = ?', [block]);
    if (!blockRow) return fail(res, 'Неизвестный блок');

    const committeeSize = await queryOne(
      'SELECT COUNT(*) AS n FROM grading_committee_members WHERE block_key = ?', [block]
    );
    const isMember = committeeSize.n
      ? await queryOne(
          'SELECT 1 AS ok FROM grading_committee_members WHERE block_key = ? AND user_login = ?',
          [block, req.user.login]
        )
      : null;

    const rows = await queryAll(`
      SELECT ga.position AS job_title,
             COUNT(DISTINCT ga.unit) AS unit_count,
             COALESCE(SUM(up.staff_count), 0) AS staff_count,
             e.id AS evaluation_id,
             e.factor_1, e.factor_2, e.factor_3, e.factor_4, e.factor_5, e.factor_6, e.factor_7,
             e.weighted_score, e.grade_level, e.evaluated_by, e.notes, e.updated_at,
             COALESCE(cs.submitted_count, 0) AS submitted_count
      FROM grading_block_assignments ga
      LEFT JOIN unit_positions up ON up.unit = ga.unit AND up.position = ga.position
      LEFT JOIN job_evaluations e ON e.block_key = ga.block_key AND e.job_title = ga.position
      LEFT JOIN (
        SELECT job_title, COUNT(DISTINCT evaluator_login) AS submitted_count
        FROM grading_committee_evaluations WHERE block_key = ?
        GROUP BY job_title
      ) cs ON cs.job_title = ga.position
      WHERE ga.block_key = ?
      GROUP BY ga.position
      ORDER BY ga.position ASC
      LIMIT ? OFFSET ?
    `, [block, block, limit, offset]);

    // Список подразделений по каждой должности — для всплывающей подсказки
    // у числа в колонке «Подразделений» (не грузить по отдельному запросу
    // на клик, сразу отдаём вместе со страницей должностей).
    if (rows.length) {
      const titles = rows.map(r => r.job_title);
      const unitRows = await queryAll(`
        SELECT ga.position AS job_title, ga.unit AS unit, COALESCE(up.staff_count, 0) AS staff_count
        FROM grading_block_assignments ga
        LEFT JOIN unit_positions up ON up.unit = ga.unit AND up.position = ga.position
        WHERE ga.block_key = ? AND ga.position IN (${titles.map(() => '?').join(',')})
        ORDER BY ga.unit ASC
      `, [block, ...titles]);
      const unitsByTitle = new Map();
      unitRows.forEach(u => {
        if (!unitsByTitle.has(u.job_title)) unitsByTitle.set(u.job_title, []);
        unitsByTitle.get(u.job_title).push({ unit: u.unit, staffCount: u.staff_count });
      });
      rows.forEach(r => { r.units = unitsByTitle.get(r.job_title) || []; });
    }

    // Своя (слепая) заявка эксперта — можно вернуть себе для правки, чужие
    // ответы сюда никогда не попадают.
    if (committeeSize.n) {
      const own = await queryAll(
        'SELECT job_title, factor_1, factor_2, factor_3, factor_4, factor_5, factor_6, factor_7, notes FROM grading_committee_evaluations WHERE block_key = ? AND evaluator_login = ?',
        [block, req.user.login]
      );
      const ownByTitle = new Map(own.map(o => [o.job_title, o]));
      rows.forEach(r => {
        const mine = ownByTitle.get(r.job_title);
        r.committee_size = committeeSize.n;
        r.my_submission = mine || null;
      });
    }

    return res.json({
      ok: true,
      block: blockRow,
      committeeSize: committeeSize.n || 0,
      isCommitteeMember: !!isMember,
      factorCount: FACTOR_COUNT,
      rows,
      limit,
      offset
    });
  } catch (err) {
    return handleError(res, err, 'getPositions');
  }
}

/**
 * Сохранение оценки должности. Если у блока настроена комиссия
 * (grading_committee_members) — это слепая индивидуальная заявка эксперта
 * (grading_committee_evaluations), итог считается только когда сдали все;
 * до этого момента чужие ответы никому не показываются. Если комиссия для
 * блока не настроена — старый однократный режим: пишем прямо в
 * job_evaluations (повторная отправка перезаписывает прошлую).
 */
async function evaluate(req, res) {
  try {
    const block = readText(req.body && req.body.block, 100);
    const jobTitle = readText(req.body && req.body.job_title, 300);
    const notes = readText(req.body && req.body.notes);
    const factors = (req.body && req.body.factors) || [];

    if (!block || !jobTitle) return fail(res, 'Укажите блок и должность');
    const blockRow = await queryOne('SELECT key FROM grading_blocks WHERE key = ?', [block]);
    if (!blockRow) return fail(res, 'Неизвестный блок');

    // Должность обязана реально относиться к блоку — иначе комиссия могла бы
    // оценить произвольную строку, не привязанную ни к одному подразделению.
    const assigned = await queryOne(
      'SELECT unit FROM grading_block_assignments WHERE block_key = ? AND position = ? LIMIT 1',
      [block, jobTitle]
    );
    if (!assigned) return fail(res, 'Эта должность не относится к выбранному блоку');

    const result = evaluatePosition(factors);
    const [f1, f2, f3, f4, f5, f6, f7] = result.factors;

    const committeeSize = await queryOne(
      'SELECT COUNT(*) AS n FROM grading_committee_members WHERE block_key = ?', [block]
    );

    if (committeeSize.n > 0) {
      return await evaluateAsCommittee(req, res, { block, jobTitle, unit: assigned.unit, result, f1, f2, f3, f4, f5, f6, f7, notes, committeeSize: committeeSize.n });
    }

    await run(`
      INSERT INTO job_evaluations
        (block_key, job_title, unit, factor_1, factor_2, factor_3, factor_4, factor_5, factor_6, factor_7,
         weighted_score, grade_level, evaluated_by, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(block_key, job_title) DO UPDATE SET
        factor_1 = excluded.factor_1,
        factor_2 = excluded.factor_2,
        factor_3 = excluded.factor_3,
        factor_4 = excluded.factor_4,
        factor_5 = excluded.factor_5,
        factor_6 = excluded.factor_6,
        factor_7 = excluded.factor_7,
        weighted_score = excluded.weighted_score,
        grade_level = excluded.grade_level,
        evaluated_by = excluded.evaluated_by,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
    `, [
      block, jobTitle, assigned.unit, f1, f2, f3, f4, f5, f6, f7,
      result.weightedScore, result.gradeLevel, req.user.fio || req.user.login, notes || null
    ]);

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'грейдирование должности',
      `${block} / ${jobTitle}: балл ${result.weightedScore}, уровень ${result.gradeLevel}`
    ]);

    return res.json({ ok: true, ...result, message: 'Оценка сохранена' });
  } catch (err) {
    return handleError(res, err, 'evaluate');
  }
}

/** Слепая заявка одного члена комиссии; при последней — подводит итог. */
async function evaluateAsCommittee(req, res, ctx) {
  const { block, jobTitle, unit, result, f1, f2, f3, f4, f5, f6, f7, notes, committeeSize } = ctx;

  const member = await queryOne(
    'SELECT 1 AS ok FROM grading_committee_members WHERE block_key = ? AND user_login = ?',
    [block, req.user.login]
  );
  if (!member) return fail(res, 'Вы не входите в комиссию этого блока', 403);

  // Итог уже утверждён (все сдали, или админ/C&B подвели вручную) — дальше
  // менять индивидуальные заявки нельзя, только «Сбросить» (grading:blocks)
  // возвращает должность в исходное «не оценено». Раньше на этом месте
  // проверки не было: повторная отправка кем угодно из комиссии молча
  // пересчитывала уже утверждённый итог.
  const already = await queryOne(
    'SELECT grade_level FROM job_evaluations WHERE block_key = ? AND job_title = ?',
    [block, jobTitle]
  );
  if (already && already.grade_level != null) {
    return fail(res, 'Оценка уже утверждена комиссией — изменить нельзя. Обратитесь к администратору или C&B за сбросом.', 409);
  }

  await run(`
    INSERT INTO grading_committee_evaluations
      (block_key, job_title, evaluator_login, factor_1, factor_2, factor_3, factor_4, factor_5, factor_6, factor_7, weighted_score, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(block_key, job_title, evaluator_login) DO UPDATE SET
      factor_1 = excluded.factor_1,
      factor_2 = excluded.factor_2,
      factor_3 = excluded.factor_3,
      factor_4 = excluded.factor_4,
      factor_5 = excluded.factor_5,
      factor_6 = excluded.factor_6,
      factor_7 = excluded.factor_7,
      weighted_score = excluded.weighted_score,
      notes = excluded.notes,
      submitted_at = CURRENT_TIMESTAMP
  `, [block, jobTitle, req.user.login, f1, f2, f3, f4, f5, f6, f7, result.weightedScore, notes || null]);

  await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
    req.user.login,
    'слепая оценка должности (комиссия)',
    `${block} / ${jobTitle}`
  ]);

  const submissions = await queryAll(
    'SELECT evaluator_login, weighted_score, factor_1, factor_2, factor_3, factor_4, factor_5, factor_6, factor_7 FROM grading_committee_evaluations WHERE block_key = ? AND job_title = ?',
    [block, jobTitle]
  );

  if (submissions.length < committeeSize) {
    return res.json({
      ok: true, pending: true,
      weightedScore: result.weightedScore, gradeLevel: result.gradeLevel,
      submittedCount: submissions.length, committeeSize,
      message: `Ваша оценка принята. Сдали ${submissions.length} из ${committeeSize} — итог появится, когда ответят все`
    });
  }

  const summary = await finalizeCommitteeResult(block, jobTitle, unit, submissions, req.user.login);
  return res.json({
    ok: true, finalized: true,
    ...summary, committeeSize,
    message: 'Комиссия завершила оценку — все ответы получены'
  });
}

/**
 * Считает итог по сданным заявкам комиссии и пишет его в job_evaluations —
 * общая часть для «сдали все сами» и для принудительного подведения итога
 * администратором (если кто-то из комиссии выбыл и достроить кворум некому).
 */
async function finalizeCommitteeResult(block, jobTitle, unit, submissions, actorLogin) {
  // Средний балл по всем заявкам; уровень — по единой для всей компании шкале.
  const avgScore = Math.round(
    (submissions.reduce((sum, s) => sum + s.weighted_score, 0) / submissions.length) * 100
  ) / 100;
  const finalGrade = calcGrade(avgScore);

  // Средний балл по каждому вопросу отдельно — factor_1..7 в job_evaluations
  // NOT NULL, а единого «правильного» ответа у комиссии нет, только среднее.
  const avgFactor = idx => {
    const values = submissions.map(s => s[`factor_${idx}`]).filter(v => v != null);
    if (!values.length) return null;
    return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
  };
  const avgF1 = avgFactor(1);
  const avgF2 = avgFactor(2);
  const avgF3 = avgFactor(3);
  const avgF4 = avgFactor(4);
  const avgF5 = avgFactor(5);
  const avgF6 = avgFactor(6);
  const avgF7 = avgFactor(7);

  const evaluators = await queryAll(
    `SELECT fio, login FROM users WHERE login IN (${submissions.map(() => '?').join(',')})`,
    submissions.map(s => s.evaluator_login)
  );
  const names = evaluators.map(e => e.fio || e.login);
  const evaluatedBy = `Комиссия (${submissions.length}): ${names.join(', ')}`;

  await run(`
    INSERT INTO job_evaluations
      (block_key, job_title, unit, factor_1, factor_2, factor_3, factor_4, factor_5, factor_6, factor_7,
       weighted_score, grade_level, evaluated_by, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(block_key, job_title) DO UPDATE SET
      factor_1 = excluded.factor_1, factor_2 = excluded.factor_2,
      factor_3 = excluded.factor_3, factor_4 = excluded.factor_4,
      factor_5 = excluded.factor_5, factor_6 = excluded.factor_6,
      factor_7 = excluded.factor_7,
      weighted_score = excluded.weighted_score,
      grade_level = excluded.grade_level,
      evaluated_by = excluded.evaluated_by,
      notes = NULL,
      updated_at = CURRENT_TIMESTAMP
  `, [block, jobTitle, unit, avgF1, avgF2, avgF3, avgF4, avgF5, avgF6, avgF7, avgScore, finalGrade, evaluatedBy]);

  await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
    actorLogin,
    'оценка должности завершена комиссией',
    `${block} / ${jobTitle}: средний балл ${avgScore}, уровень ${finalGrade} (${submissions.length} экспертов)`
  ]);

  return { weightedScore: avgScore, gradeLevel: finalGrade, submittedCount: submissions.length };
}

/**
 * Админ принудительно подводит итог по тем заявкам, что уже сданы — на
 * случай если член комиссии выбыл (в отпуске, уволился) и полного кворума
 * никогда не будет. Нужна хотя бы одна заявка.
 */
async function forceFinalizeCommittee(req, res) {
  try {
    const body = req.body || {};
    const block = readText(body.block, 100);
    const jobTitle = readText(body.job_title, 300);
    if (!block || !jobTitle) return fail(res, 'Укажите блок и должность');

    const assigned = await queryOne(
      'SELECT unit FROM grading_block_assignments WHERE block_key = ? AND position = ? LIMIT 1',
      [block, jobTitle]
    );
    if (!assigned) return fail(res, 'Эта должность не относится к выбранному блоку');

    const submissions = await queryAll(
      'SELECT evaluator_login, weighted_score, factor_1, factor_2, factor_3, factor_4, factor_5, factor_6, factor_7 FROM grading_committee_evaluations WHERE block_key = ? AND job_title = ?',
      [block, jobTitle]
    );
    if (!submissions.length) return fail(res, 'По этой должности пока нет ни одной заявки комиссии');

    const summary = await finalizeCommitteeResult(block, jobTitle, assigned.unit, submissions, req.user.login);
    return res.json({ ok: true, ...summary, message: `Итог подведён вручную по ${submissions.length} заявкам` });
  } catch (err) {
    return handleError(res, err, 'forceFinalizeCommittee');
  }
}

/**
 * Полный сброс оценки должности: снимает итоговый грейд и, если блок с
 * комиссией, удаляет вообще все слепые заявки экспертов по этой должности —
 * не «переоценить», а вернуть строку в исходное «не оценено». Обычная правка
 * (кнопка «Изменить») этого не делает нарочно, чтобы члены комиссии не могли
 * случайно стереть чужие голоса — сброс доступен только тем, кто управляет
 * блоками (grading:blocks), не всем, у кого просто grading:edit.
 */
async function resetEvaluation(req, res) {
  try {
    const body = req.body || {};
    const block = readText(body.block, 100);
    const jobTitle = readText(body.job_title, 300);
    if (!block || !jobTitle) return fail(res, 'Укажите блок и должность');

    const assigned = await queryOne(
      'SELECT unit FROM grading_block_assignments WHERE block_key = ? AND position = ? LIMIT 1',
      [block, jobTitle]
    );
    if (!assigned) return fail(res, 'Эта должность не относится к выбранному блоку');

    await run('DELETE FROM job_evaluations WHERE block_key = ? AND job_title = ?', [block, jobTitle]);
    const removed = await run(
      'DELETE FROM grading_committee_evaluations WHERE block_key = ? AND job_title = ?', [block, jobTitle]
    );

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'сброс оценки должности',
      `${block} / ${jobTitle}` + (removed.rowsAffected ? ` (снята ${removed.rowsAffected} заявка(и) комиссии)` : '')
    ]);

    return res.json({ ok: true, message: 'Оценка сброшена — должность снова «не оценена»' });
  } catch (err) {
    return handleError(res, err, 'resetEvaluation');
  }
}

/**
 * Разбивка по должности для комиссии: кто из членов комиссии что выбрал по
 * каждому фактору — «карточка сравнения» перед утверждением итога (кнопка
 * рядом со счётчиком «сдали N из M» в списке должностей). Доступ — только
 * тем, кто управляет блоками (grading:blocks), как и «Сбросить»: до
 * утверждения это чужие голоса, которые не должны быть видны всем подряд.
 */
async function getCommitteeBreakdown(req, res) {
  try {
    const block = readText(req.query.block, 100);
    const jobTitle = readText(req.query.job_title, 300);
    if (!block || !jobTitle) return fail(res, 'Укажите блок и должность');

    const submissions = await queryAll(`
      SELECT c.evaluator_login, COALESCE(u.fio, c.evaluator_login) AS evaluator_fio,
             c.factor_1, c.factor_2, c.factor_3, c.factor_4, c.factor_5, c.factor_6, c.factor_7,
             c.weighted_score, c.notes, c.submitted_at
      FROM grading_committee_evaluations c
      LEFT JOIN users u ON u.login = c.evaluator_login
      WHERE c.block_key = ? AND c.job_title = ?
      ORDER BY c.submitted_at ASC
    `, [block, jobTitle]);

    const final = await queryOne(
      'SELECT weighted_score, grade_level, factor_1, factor_2, factor_3, factor_4, factor_5, factor_6, factor_7, evaluated_by FROM job_evaluations WHERE block_key = ? AND job_title = ?',
      [block, jobTitle]
    );
    const committeeSize = await queryOne(
      'SELECT COUNT(*) AS n FROM grading_committee_members WHERE block_key = ?', [block]
    );

    return res.json({
      ok: true,
      submissions,
      final: final || null,
      finalized: !!(final && final.grade_level != null),
      committeeSize: committeeSize.n || 0,
    });
  } catch (err) {
    return handleError(res, err, 'getCommitteeBreakdown');
  }
}

/** Сводка: сколько должностей на каждом уровне, в разрезе блоков. */
async function getStats(req, res) {
  try {
    const rows = await queryAll(`
      SELECT block_key, grade_level, COUNT(*) AS n
      FROM job_evaluations
      GROUP BY block_key, grade_level
      ORDER BY block_key ASC, grade_level ASC
    `);

    const total = rows.reduce((sum, r) => sum + Number(r.n || 0), 0);
    return res.json({ ok: true, total, rows });
  } catch (err) {
    return handleError(res, err, 'getStats');
  }
}

// ─── Админка: управление индустриальными блоками ───
// Автоматическая раскладка (см. migrate.js, seedGradingBlocks) верна почти
// везде, но не может учесть штучные исключения, которые C&B видит только
// разбирая штатку глазами. Здесь — точечная правка: посмотреть состав блока,
// найти ошибку, перекинуть одну пару «подразделение+должность» в другой блок.

const UNASSIGNED_KEY = 'unassigned';

/** Блоки + псевдо-блок «Не распределено» (штатные позиции без пары в раскладке). */
async function getAdminBlocks(req, res) {
  try {
    const rows = await queryAll(`
      SELECT b.key, b.label, b.sort, COUNT(ga.id) AS pair_count
      FROM grading_blocks b
      LEFT JOIN grading_block_assignments ga ON ga.block_key = b.key
      GROUP BY b.key
      ORDER BY b.sort ASC
    `);
    const unassigned = await queryOne(`
      SELECT COUNT(*) AS n
      FROM unit_positions up
      LEFT JOIN grading_block_assignments ga ON ga.unit = up.unit AND ga.position = up.position
      WHERE ga.id IS NULL
    `);
    if (unassigned && unassigned.n) {
      rows.push({ key: UNASSIGNED_KEY, label: 'Не распределено', sort: 999, pair_count: unassigned.n });
    }
    return res.json({ ok: true, rows });
  } catch (err) {
    return handleError(res, err, 'getAdminBlocks');
  }
}

/** Состав блока: пары «подразделение+должность» с поиском по подстроке. */
async function getAdminBlockPositions(req, res) {
  try {
    const block = readText(req.query.block, 100);
    const q = readText(req.query.q, 200).toLowerCase();
    if (!block) return fail(res, 'Укажите блок');

    let rows;
    if (block === UNASSIGNED_KEY) {
      rows = await queryAll(`
        SELECT up.unit, up.position, up.staff_count
        FROM unit_positions up
        LEFT JOIN grading_block_assignments ga ON ga.unit = up.unit AND ga.position = up.position
        WHERE ga.id IS NULL
        ORDER BY up.unit ASC, up.position ASC
      `);
    } else {
      const blockRow = await queryOne('SELECT key FROM grading_blocks WHERE key = ?', [block]);
      if (!blockRow) return fail(res, 'Неизвестный блок');
      rows = await queryAll(`
        SELECT ga.unit, ga.position, COALESCE(up.staff_count, 0) AS staff_count
        FROM grading_block_assignments ga
        LEFT JOIN unit_positions up ON up.unit = ga.unit AND up.position = ga.position
        WHERE ga.block_key = ?
        ORDER BY ga.unit ASC, ga.position ASC
      `, [block]);
    }

    const filtered = q
      ? rows.filter(r => r.unit.toLowerCase().includes(q) || r.position.toLowerCase().includes(q))
      : rows;

    return res.json({ ok: true, rows: filtered, total: rows.length });
  } catch (err) {
    return handleError(res, err, 'getAdminBlockPositions');
  }
}

/** Перенос одной пары «подразделение+должность» в другой блок. */
async function reassignBlockPosition(req, res) {
  try {
    const body = req.body || {};
    const unit = readText(body.unit, 300);
    const position = readText(body.position, 300);
    const block = readText(body.block, 100);

    if (!unit || !position || !block) return fail(res, 'Укажите подразделение, должность и блок');
    const blockRow = await queryOne('SELECT key FROM grading_blocks WHERE key = ?', [block]);
    if (!blockRow) return fail(res, 'Неизвестный блок');

    await run(`
      INSERT INTO grading_block_assignments (block_key, unit, position)
      VALUES (?, ?, ?)
      ON CONFLICT(unit, position) DO UPDATE SET block_key = excluded.block_key
    `, [block, unit, position]);

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'перенос должности между блоками грейдирования',
      `${unit} / ${position} → ${block}`
    ]);

    return res.json({ ok: true, message: 'Перенесено' });
  } catch (err) {
    return handleError(res, err, 'reassignBlockPosition');
  }
}

// ─── Админка: состав комиссии по блокам ───
// Комиссия — 3-4 человека на блок, каждый оценивает независимо, вслепую (см.
// evaluateAsCommittee выше). Здесь только состав: кто входит в комиссию
// какого блока. Право оценивать (grading:edit) даётся отдельно, через «Роли
// и доступы» — членство в комиссии само по себе доступ не открывает.

async function getCommittee(req, res) {
  try {
    const block = readText(req.query.block, 100);
    if (!block) return fail(res, 'Укажите блок');
    const rows = await queryAll(`
      SELECT m.user_login AS login, u.fio, u.role
      FROM grading_committee_members m
      LEFT JOIN users u ON u.login = m.user_login
      WHERE m.block_key = ?
      ORDER BY u.fio ASC
    `, [block]);
    return res.json({ ok: true, rows });
  } catch (err) {
    return handleError(res, err, 'getCommittee');
  }
}

async function addCommitteeMember(req, res) {
  try {
    const body = req.body || {};
    const block = readText(body.block, 100);
    const login = readText(body.login, 100);
    if (!block || !login) return fail(res, 'Укажите блок и пользователя');

    const blockRow = await queryOne('SELECT key FROM grading_blocks WHERE key = ?', [block]);
    if (!blockRow) return fail(res, 'Неизвестный блок');
    const user = await queryOne('SELECT login, fio FROM users WHERE login = ?', [login]);
    if (!user) return fail(res, 'Такого пользователя нет');

    await run(
      'INSERT OR IGNORE INTO grading_committee_members (block_key, user_login) VALUES (?, ?)',
      [block, login]
    );
    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login, 'добавлен в комиссию грейдирования', `${block}: ${user.fio || login}`
    ]);
    return res.json({ ok: true, message: 'Добавлено' });
  } catch (err) {
    return handleError(res, err, 'addCommitteeMember');
  }
}

/** Должности блока, где комиссия уже начала отвечать, но кворум не набран. */
async function getCommitteePending(req, res) {
  try {
    const block = readText(req.query.block, 100);
    if (!block) return fail(res, 'Укажите блок');

    const size = await queryOne('SELECT COUNT(*) AS n FROM grading_committee_members WHERE block_key = ?', [block]);
    if (!size.n) return res.json({ ok: true, committeeSize: 0, rows: [] });

    const rows = await queryAll(`
      SELECT job_title, COUNT(DISTINCT evaluator_login) AS submitted_count
      FROM grading_committee_evaluations
      WHERE block_key = ?
      GROUP BY job_title
      HAVING submitted_count < ?
      ORDER BY submitted_count DESC, job_title ASC
    `, [block, size.n]);

    return res.json({ ok: true, committeeSize: size.n, rows });
  } catch (err) {
    return handleError(res, err, 'getCommitteePending');
  }
}

async function removeCommitteeMember(req, res) {
  try {
    const body = req.body || {};
    const block = readText(body.block, 100);
    const login = readText(body.login, 100);
    if (!block || !login) return fail(res, 'Укажите блок и пользователя');

    await run('DELETE FROM grading_committee_members WHERE block_key = ? AND user_login = ?', [block, login]);
    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login, 'исключён из комиссии грейдирования', `${block}: ${login}`
    ]);
    return res.json({ ok: true, message: 'Исключён' });
  } catch (err) {
    return handleError(res, err, 'removeCommitteeMember');
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

/**
 * Сотрудники подразделения — для выпадающего списка «ФИО сотрудника» в
 * анкете незаменимости (вместо свободного текста). Основной источник — весь
 * штат из staff_directory (импорт выгрузки 1С, см. adminController.importStaffDirectory),
 * не только те, у кого есть логин. Плюс подмешиваются учётки системы (users)
 * с этим подразделением, которых почему-то нет в последней выгрузке 1С (сама
 * учётка могла быть заведена вручную позже) — дедуп по ФИО, приоритет у
 * учётки, если запись есть в обоих источниках (её должность правит сам админ).
 */
async function unitEmployees(req, res) {
  try {
    const unit = readText(req.query.unit, 300);
    if (!unit) return fail(res, 'Укажите подразделение');
    if (!canUseUnit(req.user, unit)) {
      return fail(res, 'Это подразделение вам не назначено', 403);
    }

    const [directoryRows, userRows] = await Promise.all([
      queryAll('SELECT fio, position FROM staff_directory WHERE unit = ?', [unit]),
      // units хранится строкой "Юнит1; Юнит2" — точное совпадение элемента
      // списка проверяем в JS (LIKE по подстроке подхватил бы «Отдел продаж»
      // при поиске «Отдел»).
      queryAll(
        "SELECT fio, position, units FROM users WHERE archived_at IS NULL AND active = 1 AND units IS NOT NULL AND units <> ''"
      ),
    ]);
    const matchedUsers = userRows.filter(u => u.units.split(';').map(s => s.trim()).indexOf(unit) >= 0);

    const byFio = new Map();
    directoryRows.forEach(u => byFio.set(u.fio, { fio: u.fio, position: u.position || '' }));
    matchedUsers.forEach(u => byFio.set(u.fio, { fio: u.fio, position: u.position || '' }));

    return res.json({
      ok: true,
      rows: Array.from(byFio.values()).sort((a, b) => a.fio.localeCompare(b.fio, 'ru'))
    });
  } catch (err) {
    return handleError(res, err, 'unitEmployees');
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
  getBlocks,
  getPositions,
  evaluate,
  getStats,
  getAdminBlocks,
  getAdminBlockPositions,
  reassignBlockPosition,
  getCommittee,
  addCommitteeMember,
  removeCommitteeMember,
  getCommitteePending,
  forceFinalizeCommittee,
  resetEvaluation,
  getCommitteeBreakdown,
  listRisks,
  unitEmployees,
  evaluateRiskCard,
  getHeatmap,
  // экспортируется для тестов границ видимости
  allowedUnits,
  unitScopeSql,
  RISK_FACTOR_FIELDS
};
