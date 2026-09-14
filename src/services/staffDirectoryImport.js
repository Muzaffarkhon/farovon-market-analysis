/**
 * Разбор выгрузки 1С «Список сотрудников организаций» (CSV) перед загрузкой в
 * staff_directory — справочник для анкеты «Риски штата» (см. migrate.js).
 * Используется adminController.importStaffDirectory (кнопка «Сервисные
 * утилиты → Импорт справочника сотрудников»).
 *
 * Ожидаемые колонки — заголовки листа 1С как есть, без переименования:
 * «Должность», «Подразделение организации», «ФИО (полное)». Остальные
 * колонки выгрузки (телефоны) игнорируются.
 */

const { parse } = require('csv-parse/sync');

const COLS = {
  position: 'Должность',
  unit: 'Подразделение организации',
  fio: 'ФИО (полное)',
};

function parseCsv(text) {
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
    relax_column_count: true,
  });
}

/**
 * Сверяет строки файла со справочником подразделений системы (divisions.unit)
 * и готовит итоговый набор к заливке. Строка без ФИО или подразделения
 * отбраковывается — оценивать риск всё равно не по чему.
 */
function analyze(rows, divisionUnits) {
  const knownUnits = new Set(divisionUnits);
  const seen = new Set();
  const prepared = [];
  const skipped = [];
  const unitCounts = new Map();

  rows.forEach((row, idx) => {
    const fio = String(row[COLS.fio] || '').trim();
    const unit = String(row[COLS.unit] || '').trim();
    const position = String(row[COLS.position] || '').trim();
    const rowNum = idx + 2; // +1 заголовок, +1 к 0-based индексу

    if (!fio || !unit) {
      skipped.push({ row: rowNum, reason: !fio ? 'нет ФИО' : 'нет подразделения' });
      return;
    }
    const key = unit + '' + fio;
    if (seen.has(key)) {
      skipped.push({ row: rowNum, reason: 'дубль строки в файле' });
      return;
    }
    seen.add(key);
    prepared.push({ unit, fio, position });
    unitCounts.set(unit, (unitCounts.get(unit) || 0) + 1);
  });

  const unmatchedUnits = [];
  let unmatchedCount = 0;
  unitCounts.forEach((count, unit) => {
    if (!knownUnits.has(unit)) {
      unmatchedUnits.push({ unit, count });
      unmatchedCount += count;
    }
  });
  unmatchedUnits.sort((a, b) => b.count - a.count);

  return {
    rowsInFile: rows.length,
    rowsPrepared: prepared.length,
    rowsSkipped: skipped.length,
    skippedRows: skipped.slice(0, 30),
    units: unitCounts.size,
    unmatchedUnits,
    unmatchedCount,
    prepared,
  };
}

module.exports = { COLS, parseCsv, analyze };
