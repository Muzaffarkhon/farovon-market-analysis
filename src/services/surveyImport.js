/**
 * Разбор и проверка файла «Опрос зарплаты … - Ответы» (CSV) перед загрузкой в
 * таблицу surveys. Используется контроллером admin/import (кнопка «Загрузить из
 * ноутбука» во вкладке «Сервисные утилиты») и одноразовым скриптом-тестом.
 *
 * Философия проверки (согласовано с заказчиком):
 *  - валидация на уровне ЯЧЕЙКИ, не строки: плохая ячейка пропускается (пустая /
 *    0), её адрес попадает в отчёт, строка грузится целиком;
 *  - строка отбраковывается только если нет обязательного минимума (компания);
 *  - совпадения с уже загруженными анкетами не трогаются автоматически — они
 *    уходят в отчёт, а решение (обновить / пропустить) принимает админ.
 */

const { parse } = require('csv-parse/sync');
const LEGEND = require('../data/surveyImportLegend.json');

// ── Ожидаемые колонки файла (лист «Ответы») ──
const COLS = {
  date: 'Дата',
  manager: 'Менеджер',
  region: 'Регион',
  company: 'Компания',
  companyOther: 'Другое',
  position: 'Дольжность', // опечатка в исходном файле сохранена намеренно
  schedule: 'График работы',
  salary: 'Зарплата',
  bonus: 'Бонус',
  bonusPeriod: 'Период бонуса',
  benefits: 'Льготы',
  bizId: 'ID_Бизнес',
};

const SENTINEL_POS_OUR = '(не сопоставлено)';
const SENTINEL_POS_THEIR = '(не указано)';

function norm(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/ё/g, 'е').replace(/[іӣ]/g, 'и').replace(/ӯ/g, 'у').replace(/ҳ/g, 'х')
    .replace(/қ/g, 'к').replace(/ҷ/g, 'ч').replace(/ғ/g, 'г')
    .replace(/[^a-zа-я0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseCsv(text) {
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
    relax_column_count: true,
  });
}

// «02.01.2025 12:56:51» / «02.01.2025» → ISO. Пусто/мусор → null.
function parseDate(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, d, mo, y, hh, mm, ss] = m;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, +(hh || 0), +(mm || 0), +(ss || 0)));
  if (isNaN(dt.getTime()) || +mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
  return dt.toISOString().replace('T', ' ').slice(0, 19);
}

// Числовое значение зарплаты/бонуса. Возвращает {value|null, bad:boolean}.
// bad=true — в ячейке текст (буквы): это ошибка, ячейку пропускаем.
function parseNumeric(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, '').replace(',', '.');
  if (s === '') return { value: null, bad: false };
  if (!/^\d+(\.\d+)?$/.test(s)) return { value: null, bad: true };
  return { value: Number(s), bad: false };
}

function resolveUnitFromBiz(bizRaw, positionRaw, divisionUnitSet) {
  const cleaned = String(bizRaw || '').replace(/["'\s]/g, '');
  const tokens = cleaned ? cleaned.split(/[,;.]/).filter(Boolean) : [];
  const multi = tokens.length > 1;
  const first = tokens[0] || '';

  const tryUnit = (name) => {
    if (!name) return '';
    const hit = divisionUnitSet.get(norm(name));
    return hit || '';
  };

  // 1) прямой справочник ID_Бизнес → подразделение
  if (first && LEGEND.bizToUnit[first]) {
    const u = tryUnit(LEGEND.bizToUnit[first]);
    if (u) return { unit: u, multi, tokens, via: 'biz' };
  }

  // 2) правило 555 / пусто / неизвестный ID: если должность однозначно живёт в
  //    одном направлении — привязываем туда
  const bizByTitle = LEGEND.titleToBiz[norm(positionRaw)];
  if (bizByTitle && bizByTitle.length === 1) {
    const u = tryUnit(LEGEND.bizToUnit[bizByTitle[0]]);
    if (u) return { unit: u, multi, tokens, via: 'position' };
  }

  // 3) не удалось — общая папка
  return { unit: LEGEND.unassignedUnit, multi, tokens, via: 'unassigned' };
}

/**
 * @param {object} ctx
 *   rows            — массив объектов из parseCsv
 *   divisions       — [{unit}] из БД
 *   userFios        — Set нормализованных ФИО пользователей
 *   dictCompanies   — Set нормализованных названий компаний из справочника
 *   dictPositions   — Set нормализованных должностей из справочника
 *   existingSurveys — [{sid, unit, company, pos_their, pay_from}] активные анкеты
 *   periodName      — имя текущего периода
 */
function analyze(ctx) {
  const {
    rows, divisions, userFios, dictCompanies, dictPositions,
    existingSurveys, periodName, adminName,
  } = ctx;
  const author = String(adminName || '').trim() || 'Импорт';

  const divisionUnitSet = new Map(divisions.map(d => [norm(d.unit), d.unit]));
  const existingKey = new Map();
  for (const s of existingSurveys || []) {
    existingKey.set(
      [norm(s.unit), norm(s.company), norm(s.pos_their), Math.round(s.pay_from || 0)].join('|'),
      s
    );
  }

  const prepared = [];
  const cellIssues = [];
  const skippedRows = [];
  const duplicates = [];
  const seenInFile = new Map();
  const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19);

  rows.forEach((r, i) => {
    const sheetRow = i + 2; // строка 1 — заголовок
    const issue = (column, value, rule, message) =>
      cellIssues.push({ row: sheetRow, column, value: String(value || ''), rule, message });

    // ── компания (обязательный минимум) ──
    let company = String(r[COLS.company] || '').trim();
    const other = String(r[COLS.companyOther] || '').trim();
    if (!company || norm(company) === 'другое') company = other;
    company = company.trim();
    if (!company) {
      skippedRows.push({ row: sheetRow, reason: 'нет компании (и «Компания», и «Другое» пусты)' });
      return;
    }

    // ── должность конкурента / наша ──
    const posTheir = String(r[COLS.position] || '').trim() || SENTINEL_POS_THEIR;
    const posOur = LEGEND.positionCanon[norm(r[COLS.position])] || SENTINEL_POS_OUR;

    // ── подразделение ──
    const u = resolveUnitFromBiz(r[COLS.bizId], r[COLS.position], divisionUnitSet);

    // ── зарплата ──
    const sal = parseNumeric(r[COLS.salary]);
    let payFrom = 0;
    let suspiciousHourly = false;
    if (sal.bad) {
      issue(COLS.salary, r[COLS.salary], 'text-in-number', 'текст в числовом поле — ячейка пропущена');
    } else if (sal.value == null) {
      issue(COLS.salary, r[COLS.salary], 'empty', 'зарплата не указана');
    } else {
      payFrom = sal.value;
      if (payFrom > 0 && payFrom < 100) suspiciousHourly = true;
    }

    // ── бонус ──
    const bon = parseNumeric(r[COLS.bonus]);
    let bonHas = 'не знаю';
    let bonSize = '';
    if (bon.bad) {
      issue(COLS.bonus, r[COLS.bonus], 'text-in-number', 'текст в числовом поле — ячейка пропущена');
    } else if (bon.value != null) {
      bonHas = 'да';
      bonSize = String(bon.value);
    }

    // ── период бонуса ──
    let bonPer = '';
    const bpRaw = String(r[COLS.bonusPeriod] || '').trim();
    if (bpRaw) {
      const match = LEGEND.bonusPeriods.find(p => norm(p) === norm(bpRaw));
      if (match) bonPer = match;
      else issue(COLS.bonusPeriod, bpRaw, 'not-in-list', 'нет в списке (Месячный/Квартальный/Годовой) — пропущено');
    }

    // ── льготы ── хранятся через ';' — так их читают analyticsService и анкета
    const benefits = String(r[COLS.benefits] || '')
      .split(',').map(x => x.trim()).filter(Boolean).join(';');

    // ── дата ──
    let createdAt = parseDate(r[COLS.date]);
    if (!createdAt) {
      if (String(r[COLS.date] || '').trim()) {
        issue(COLS.date, r[COLS.date], 'bad-date', 'не распознана дата — подставлено текущее время');
      }
      createdAt = nowIso;
    }

    // ── менеджер: автор анкеты — админ, который грузит; кто собрал — в примечании ──
    const manager = String(r[COLS.manager] || '').trim();
    const managerKnown = manager ? userFios.has(norm(manager)) : false;

    // ── график работы: отдельное поле (в анкете сбора данных тоже есть) ──
    const schedule = String(r[COLS.schedule] || '').trim();

    // ── примечание: то, чему нет отдельного поля ──
    const noteParts = [];
    if (manager) noteParts.push(`Собрал: ${manager}`);
    const region = String(r[COLS.region] || '').trim();
    if (region) {
      const okRegion = LEGEND.regions.some(x => norm(x) === norm(region));
      noteParts.push(okRegion ? `Регион: ${region}` : `Регион: ${region} (не из списка)`);
    }
    if (u.multi) noteParts.push(`ID_Бизнес: ${u.tokens.join(',')}`);
    if (u.via === 'unassigned' && (u.tokens[0] || '')) noteParts.push(`ID_Бизнес(не распознан): ${u.tokens[0]}`);

    // ── период: по фактическому году строки, не по текущему периоду ──
    const yearMatch = /^(\d{4})/.exec(createdAt);
    const period = yearMatch ? `Обзор рынка ${yearMatch[1]}` : (periodName || '');

    const rec = {
      sheetRow,
      sid: 'imp_' + Date.now().toString(36) + '_' + i,
      unit: u.unit,
      company,
      pos_our: posOur,
      pos_their: posTheir,
      grade: '',
      pay_from: payFrom,
      pay_to: payFrom,
      cur: 'сомони',
      pay_per: 'в месяц',
      bon_has: bonHas,
      bon_size: bonSize,
      bon_type: '',
      bon_per: bonPer,
      benefits,
      schedule,
      extra: '',
      source: 'Импорт CSV',
      trust: '',
      note: noteParts.join('; '),
      created_by: author,
      created_at: createdAt,
      state: 'активна',
      period,
      _suspiciousHourly: suspiciousHourly,
      _unitVia: u.via,
      _posOurMatched: posOur !== SENTINEL_POS_OUR,
      _managerKnown: managerKnown,
    };

    // ── дубли: в файле и против БД ──
    const key = [norm(rec.unit), norm(rec.company), norm(rec.pos_their), Math.round(rec.pay_from)].join('|');
    if (seenInFile.has(key)) {
      rec._dupInFile = seenInFile.get(key);
    } else {
      seenInFile.set(key, sheetRow);
    }
    const dbHit = existingKey.get(key);
    if (dbHit) {
      rec._dupOf = dbHit.sid;
      duplicates.push({
        row: sheetRow,
        sid: dbHit.sid,
        unit: rec.unit,
        company: rec.company,
        pos_their: rec.pos_their,
        pay_from: rec.pay_from,
      });
    }

    prepared.push(rec);
  });

  // ── сводка ──
  const distinct = (arr) => [...new Set(arr)];
  const companies = distinct(prepared.map(p => norm(p.company)));
  const positions = distinct(prepared.map(p => norm(p.pos_their)).filter(x => x && x !== norm(SENTINEL_POS_THEIR)));
  const units = distinct(prepared.map(p => p.unit));
  const managers = distinct(prepared.map(p => norm(p.created_by)).filter(Boolean));

  const newCompanies = companies.filter(c => !dictCompanies.has(c));
  const newPositions = positions.filter(p => !dictPositions.has(p));
  const newUnits = units.filter(unm => !divisionUnitSet.has(norm(unm)));

  const issuesByRule = {};
  for (const it of cellIssues) issuesByRule[it.rule] = (issuesByRule[it.rule] || 0) + 1;

  const report = {
    rowsInFile: rows.length,
    rowsPrepared: prepared.length,
    rowsSkipped: skippedRows.length,
    skippedRows,

    companies: companies.length,
    companiesNew: newCompanies.length,
    positions: positions.length,
    positionsNew: newPositions.length,
    units: units.length,
    unitsList: units,
    unitsNew: newUnits,
    unitsUnassigned: prepared.filter(p => p._unitVia === 'unassigned').length,
    unitsViaPosition: prepared.filter(p => p._unitVia === 'position').length,

    managers: managers.length,
    managersUnknown: prepared.filter(p => p.created_by && !p._managerKnown).length,

    posOurMatched: prepared.filter(p => p._posOurMatched).length,
    posOurSentinel: prepared.filter(p => !p._posOurMatched).length,

    cellIssues: cellIssues.length,
    issuesByRule,
    suspiciousHourly: prepared.filter(p => p._suspiciousHourly).length,

    duplicatesInDb: duplicates.length,
    duplicatesInFile: prepared.filter(p => p._dupInFile).length,
  };

  return { prepared, cellIssues, skippedRows, duplicates, report };
}

module.exports = {
  parseCsv,
  analyze,
  norm,
  COLS,
  LEGEND,
  SENTINEL_POS_OUR,
  SENTINEL_POS_THEIR,
};
