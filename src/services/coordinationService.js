'use strict';

/**
 * Координация для HR BP (ТЗ, раздел 1.4) — прогресс по направлениям и по
 * людям, лента последних записей. Отдельно от `dashboardController.
 * getHRBPDashboard`: та функция считает пары «должность × компания» для
 * старого клиента и не трогается. Здесь — «должность решена / не решена»,
 * той же математикой, что уже использует `analyticsService.positionProgress`
 * (реестр и дашборд), плюс охват по людям, которого раньше не было нигде.
 *
 * Массово: один проход по трём таблицам, группировка в памяти — не запрос
 * на подразделение (326 подразделений × несколько запросов было бы слишком
 * дорого; `positionProgressForUnit` для этого сценария не подходит).
 */

const { queryAll } = require('../db/database');
const { positionProgress, resolveDashboardPeriodId, parseBonusesCol } = require('./analyticsService');

const trim = (v) => String(v == null ? '' : v).trim();

/** Состояние подразделения: «нет штатки» не путаем с «решено полностью». */
function unitState(decided, total) {
  if (total === 0) return 'не начато';
  return decided === total ? 'полностью' : (decided > 0 ? 'в процессе' : 'не начато');
}

/** Группировка построчных данных по unit — общий паттерн для всех трёх таблиц. */
function groupByUnit(rows) {
  const map = new Map();
  rows.forEach(r => {
    const u = trim(r.unit);
    if (!u) return;
    if (!map.has(u)) map.set(u, []);
    map.get(u).push(r);
  });
  return map;
}

/**
 * Чистая функция: уже прочитанные строки → { units, people, feed }.
 * `unitFilter` — предикат по строке divisions (см. services/scopeService),
 * либо null/undefined — без ограничения.
 */
function buildCoordination({ divisions, unitPositions, surveys, noComparison, users, assignments }, unitFilter) {
  const visibleDivisions = unitFilter ? divisions.filter(unitFilter) : divisions;
  const allowedUnits = new Set(visibleDivisions.map(d => trim(d.unit)));

  const positionsByUnit = groupByUnit(unitPositions);
  const surveysByUnit = groupByUnit(surveys);
  const noComparisonByUnit = groupByUnit(noComparison);

  // Прогресс по каждому видимому подразделению — считается один раз и
  // переиспользуется и в units[], и при суммировании охвата людей.
  const progressByUnit = new Map();
  visibleDivisions.forEach(d => {
    const unit = trim(d.unit);
    const positions = (positionsByUnit.get(unit) || []).map(r => r.position);
    const unitSurveys = (surveysByUnit.get(unit) || []).map(r => ({
      posOur: r.pos_our, payFrom: r.pay_from, payTo: r.pay_to,
      // bonuses в базе — JSON-строка/старые bon_*-колонки; тот же разбор,
      // что и в positionProgressForUnit, иначе surveyHasSubstance молча не
      // увидит премию (Array.isArray на сырой строке — всегда false).
      bonuses: parseBonusesCol(r.bonuses, r.bon_type, r.bon_size, r.bon_per),
      extra: r.extra, note: r.note,
      // benefits хранится строкой «а;б» — surveyHasSubstance принимает и строку, и массив.
      benefits: r.benefits
    }));
    const noComp = (noComparisonByUnit.get(unit) || []).map(r => r.pos_our);
    const { decided, total } = positionProgress({ positions, surveys: unitSurveys, noComparison: noComp });
    const lastActivityAt = (surveysByUnit.get(unit) || [])
      .reduce((max, r) => (r.created_at && r.created_at > max ? r.created_at : max), '');
    progressByUnit.set(unit, { decided, total, lastActivityAt });
  });

  const units = visibleDivisions.map(d => {
    const unit = trim(d.unit);
    const p = progressByUnit.get(unit) || { decided: 0, total: 0, lastActivityAt: '' };
    return {
      unit, dir: trim(d.dir), hrbp: trim(d.hrbp), resp: trim(d.resp), head: trim(d.head),
      positionsTotal: p.total, positionsDecided: p.decided,
      state: unitState(p.decided, p.total),
      lastActivityAt: p.lastActivityAt
    };
  });

  // Люди: units.units (реальное назначение на сбор) плюс resp/head видимого
  // подразделения — по ID пользователя (division_assignments), не по
  // совпадению ФИО: переименование человека раньше «отвязывало» его от
  // подразделений в этом списке (ТЗ, раздел 12, пункт 5). Набор объединяем,
  // а не складываем дважды.
  const respHeadByUserId = new Map(); // userId -> Set(unit)
  (assignments || []).forEach(a => {
    if (!allowedUnits.has(a.unit)) return;
    if (!respHeadByUserId.has(a.userId)) respHeadByUserId.set(a.userId, new Set());
    respHeadByUserId.get(a.userId).add(a.unit);
  });

  const people = users.map(u => {
    const own = trim(u.units).split(';').map(trim).filter(Boolean).filter(x => allowedUnits.has(x));
    const viaRole = respHeadByUserId.get(u.id) || new Set();
    const unitSet = new Set([...own, ...viaRole]);
    let positionsTotal = 0;
    let positionsDecided = 0;
    unitSet.forEach(unit => {
      const p = progressByUnit.get(unit);
      if (!p) return;
      positionsTotal += p.total;
      positionsDecided += p.decided;
    });
    return {
      login: u.login, fio: trim(u.fio), units: Array.from(unitSet),
      positionsTotal, positionsDecided,
      lastLoginAt: u.last_login_at || '',
      hasTelegram: !!u.telegram_chat_id
    };
  }).filter(p => p.units.length > 0);

  const feed = [...surveys]
    .filter(r => allowedUnits.has(trim(r.unit)))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 30)
    .map(r => ({
      unit: trim(r.unit),
      dir: trim((visibleDivisions.find(d => trim(d.unit) === trim(r.unit)) || {}).dir),
      company: trim(r.company), posOur: trim(r.pos_our),
      by: trim(r.created_by), at: r.created_at || ''
    }));

  return { units, people, feed };
}

async function loadCoordinationData(filters = {}) {
  const periods = await queryAll('SELECT id, is_active AS "isActive" FROM periods ORDER BY id DESC').catch(() => []);
  const currentId = (periods.find(p => p.isActive) || periods[0] || {}).id ?? null;
  const periodId = resolveDashboardPeriodId(filters.period, currentId);

  const surveyCols = 'unit, company, pos_our, pay_from, pay_to, bonuses, bon_type, bon_size, bon_per, benefits, extra, note, created_by, created_at';
  const [divisions, unitPositions, surveys, noComparison, users, assignments] = await Promise.all([
    queryAll('SELECT num, dir, unit, resp, head, hrbp FROM divisions'),
    queryAll('SELECT unit, position FROM unit_positions'),
    periodId
      ? queryAll(`SELECT ${surveyCols} FROM surveys WHERE state != 'удалена' AND period_id = ?`, [periodId])
      : queryAll(`SELECT ${surveyCols} FROM surveys WHERE state != 'удалена'`),
    periodId
      ? queryAll('SELECT unit, pos_our FROM position_no_comparison WHERE period_id = ?', [periodId])
      : queryAll('SELECT unit, pos_our FROM position_no_comparison'),
    queryAll("SELECT id, login, fio, units, last_login_at, telegram_chat_id FROM users WHERE active = 1 AND archived_at IS NULL"),
    // ID-связь head/resp (division_assignments), не текстовое ФИО — см.
    // комментарий у respByUserId в buildCoordination.
    queryAll(`SELECT d.unit AS unit, a.user_id AS "userId" FROM division_assignments a
                JOIN divisions d ON d.id = a.division_id WHERE a.kind IN ('head', 'resp')`)
  ]);

  return { divisions, unitPositions, surveys, noComparison, users, assignments };
}

async function getCoordination(filters = {}, opts = {}) {
  const data = await loadCoordinationData(filters);
  return { ok: true, ...buildCoordination(data, opts.unitFilter) };
}

module.exports = { buildCoordination, getCoordination };
