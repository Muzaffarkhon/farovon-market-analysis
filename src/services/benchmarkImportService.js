const { queryAll, queryOne, run, batch } = require('../db/database');

/**
 * Разбор CSV/TSV строки в массив строк и столбцов.
 * Поддерживает разделители ',', ';', '\t'.
 */
function parseTableText(text) {
  if (!text || !text.trim()) return [];
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return [];

  // Определяем разделитель по первой строке
  const firstLine = lines[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;

  let delimiter = ',';
  if (tabCount >= semiCount && tabCount >= commaCount && tabCount > 0) delimiter = '\t';
  else if (semiCount >= commaCount && semiCount > 0) delimiter = ';';

  return lines.map(line => {
    // Простой разбор с учетом кавычек
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === delimiter && !inQuotes) {
        cells.push(cur.trim().replace(/^"(.*)"$/, '$1'));
        cur = '';
      } else {
        cur += c;
      }
    }
    cells.push(cur.trim().replace(/^"(.*)"$/, '$1'));
    return cells;
  });
}

function parseNumber(v) {
  if (v == null) return 0;
  const cleaned = String(v).replace(/\s+/g, '').replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

class BenchmarkImportService {
  /**
   * Dry-run предпросмотр импорта данных
   */
  async dryRun({ sourceKey, text, mode = 'percentiles', columnMap = {}, currency = 'сомони', reportDate = '', dataAsOf = '', title = '' }) {
    const source = await queryOne('SELECT * FROM data_sources WHERE key = ?', [sourceKey]);
    if (!source) {
      throw new Error(`Источник данных "${sourceKey}" не найден`);
    }

    const grid = parseTableText(text);
    if (grid.length < 2) {
      throw new Error('Таблица должна содержать как минимум строку заголовков и 1 строку данных');
    }

    const headers = grid[0];
    const dataRows = grid.slice(1);

    const posColIdx = columnMap.posLabel != null ? Number(columnMap.posLabel) : 0;
    const codeColIdx = columnMap.code != null ? Number(columnMap.code) : -1;
    const regionColIdx = columnMap.region != null ? Number(columnMap.region) : -1;
    const gradeColIdx = columnMap.grade != null ? Number(columnMap.grade) : -1;

    const existingSourcePositions = await queryAll('SELECT id, label, code FROM source_positions WHERE source_key = ?', [sourceKey]);
    const posMap = new Map();
    existingSourcePositions.forEach(p => posMap.set(p.label.toLowerCase(), p));

    const previewRows = [];
    const errors = [];
    const warnings = [];
    const newPositions = new Set();
    let validRowCount = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const lineNum = i + 2;
      const label = row[posColIdx] ? String(row[posColIdx]).trim() : '';

      if (!label) {
        warnings.push({ line: lineNum, message: 'Пропущено: пустое название должности' });
        continue;
      }

      if (!posMap.has(label.toLowerCase())) {
        newPositions.add(label);
      }

      const code = codeColIdx >= 0 ? (row[codeColIdx] || '').trim() : '';
      const region = regionColIdx >= 0 ? (row[regionColIdx] || '').trim() : '';
      const grade = gradeColIdx >= 0 ? (row[gradeColIdx] || '').trim() : '';

      if (mode === 'percentiles') {
        const p25 = parseNumber(columnMap.p25 != null ? row[columnMap.p25] : 0);
        const p50 = parseNumber(columnMap.p50 != null ? row[columnMap.p50] : (columnMap.avg != null ? row[columnMap.avg] : 0));
        const p75 = parseNumber(columnMap.p75 != null ? row[columnMap.p75] : 0);
        const sampleN = columnMap.sampleN != null ? parseInt(parseNumber(row[columnMap.sampleN])) || 1 : 1;

        if (p50 <= 0 && p25 <= 0 && p75 <= 0) {
          errors.push({ line: lineNum, message: `Должность "${label}": не указаны числовые значения зарплат/перцентилей` });
          continue;
        }

        validRowCount++;
        if (previewRows.length < 10) {
          previewRows.push({
            line: lineNum,
            label,
            code,
            region,
            grade,
            p25,
            p50,
            p75,
            sampleN,
            currency
          });
        }
      } else {
        // Сырые вакансии
        const val = parseNumber(columnMap.value != null ? row[columnMap.value] : (columnMap.payFrom != null ? row[columnMap.payFrom] : 0));
        if (val <= 0) {
          errors.push({ line: lineNum, message: `Должность "${label}": не указано значение оклада` });
          continue;
        }

        validRowCount++;
        if (previewRows.length < 10) {
          previewRows.push({
            line: lineNum,
            label,
            code,
            region,
            grade,
            value: val,
            currency
          });
        }
      }
    }

    return {
      ok: true,
      source: {
        key: source.key,
        title: source.title,
        isLicensed: !!source.is_licensed
      },
      headers,
      totalLines: dataRows.length,
      validRows: validRowCount,
      newPositionsCount: newPositions.size,
      newPositionsList: Array.from(newPositions).slice(0, 20),
      preview: previewRows,
      errors: errors.slice(0, 30),
      warnings: warnings.slice(0, 30)
    };
  }

  /**
   * Выполнение импорта и сохранение датасета в БД
   */
  async commit({ sourceKey, text, mode = 'percentiles', columnMap = {}, currency = 'сомони', reportDate = '', dataAsOf = '', title = '', user = null }) {
    const dry = await this.dryRun({ sourceKey, text, mode, columnMap, currency, reportDate, dataAsOf, title });
    if (dry.validRows === 0) {
      throw new Error('В файле нет валидных строк для импорта');
    }

    const grid = parseTableText(text);
    const dataRows = grid.slice(1);

    const posColIdx = columnMap.posLabel != null ? Number(columnMap.posLabel) : 0;
    const codeColIdx = columnMap.code != null ? Number(columnMap.code) : -1;
    const regionColIdx = columnMap.region != null ? Number(columnMap.region) : -1;
    const gradeColIdx = columnMap.grade != null ? Number(columnMap.grade) : -1;
    const industryColIdx = columnMap.industry != null ? Number(columnMap.industry) : -1;

    // 1. Создаем датасет
    const datasetTitle = title || `${dry.source.title} (${dataAsOf || new Date().toISOString().slice(0, 10)})`;
    const datasetRes = await run(`
      INSERT INTO benchmark_datasets (source_key, title, report_date, data_as_of, currency, uploaded_by, state, row_count)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
    `, [sourceKey, datasetTitle, reportDate || null, dataAsOf || null, currency, user ? (user.fio || user.login) : 'admin', dry.validRows]);

    const datasetId = datasetRes.lastInsertRowid || datasetRes.insertId;

    // 2. Гарантируем наличие всех должностей источника
    const existingPos = await queryAll('SELECT id, label FROM source_positions WHERE source_key = ?', [sourceKey]);
    const posIdMap = new Map();
    existingPos.forEach(p => posIdMap.set(p.label.toLowerCase(), p.id));

    const stmts = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const label = row[posColIdx] ? String(row[posColIdx]).trim() : '';
      if (!label) continue;

      let sourcePosId = posIdMap.get(label.toLowerCase());
      if (!sourcePosId) {
        const code = codeColIdx >= 0 ? (row[codeColIdx] || '').trim() : null;
        const insPos = await run('INSERT INTO source_positions (source_key, code, label) VALUES (?, ?, ?)', [sourceKey, code, label]);
        sourcePosId = insPos.lastInsertRowid || insPos.insertId;
        posIdMap.set(label.toLowerCase(), sourcePosId);
      }

      const region = regionColIdx >= 0 ? (row[regionColIdx] || '').trim() : null;
      const grade = gradeColIdx >= 0 ? (row[gradeColIdx] || '').trim() : null;
      const industry = industryColIdx >= 0 ? (row[industryColIdx] || '').trim() : null;

      if (mode === 'percentiles') {
        const p10 = parseNumber(columnMap.p10 != null ? row[columnMap.p10] : 0);
        const p25 = parseNumber(columnMap.p25 != null ? row[columnMap.p25] : 0);
        const p50 = parseNumber(columnMap.p50 != null ? row[columnMap.p50] : (columnMap.avg != null ? row[columnMap.avg] : 0));
        const p75 = parseNumber(columnMap.p75 != null ? row[columnMap.p75] : 0);
        const p90 = parseNumber(columnMap.p90 != null ? row[columnMap.p90] : 0);
        const minVal = parseNumber(columnMap.min != null ? row[columnMap.min] : 0);
        const maxVal = parseNumber(columnMap.max != null ? row[columnMap.max] : 0);
        const avgVal = parseNumber(columnMap.avg != null ? row[columnMap.avg] : 0);
        const sampleN = columnMap.sampleN != null ? parseInt(parseNumber(row[columnMap.sampleN])) || 1 : 1;

        if (p50 > 0) stmts.push({ sql: 'INSERT INTO benchmark_rows (dataset_id, source_position_id, region, industry, grade, currency, stat_type, value, sample_n) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', args: [datasetId, sourcePosId, region, industry, grade, currency, 'p50', p50, sampleN] });
        if (p25 > 0) stmts.push({ sql: 'INSERT INTO benchmark_rows (dataset_id, source_position_id, region, industry, grade, currency, stat_type, value, sample_n) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', args: [datasetId, sourcePosId, region, industry, grade, currency, 'p25', p25, sampleN] });
        if (p75 > 0) stmts.push({ sql: 'INSERT INTO benchmark_rows (dataset_id, source_position_id, region, industry, grade, currency, stat_type, value, sample_n) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', args: [datasetId, sourcePosId, region, industry, grade, currency, 'p75', p75, sampleN] });
        if (p10 > 0) stmts.push({ sql: 'INSERT INTO benchmark_rows (dataset_id, source_position_id, region, industry, grade, currency, stat_type, value, sample_n) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', args: [datasetId, sourcePosId, region, industry, grade, currency, 'p10', p10, sampleN] });
        if (p90 > 0) stmts.push({ sql: 'INSERT INTO benchmark_rows (dataset_id, source_position_id, region, industry, grade, currency, stat_type, value, sample_n) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', args: [datasetId, sourcePosId, region, industry, grade, currency, 'p90', p90, sampleN] });
        if (minVal > 0) stmts.push({ sql: 'INSERT INTO benchmark_rows (dataset_id, source_position_id, region, industry, grade, currency, stat_type, value, sample_n) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', args: [datasetId, sourcePosId, region, industry, grade, currency, 'min', minVal, sampleN] });
        if (maxVal > 0) stmts.push({ sql: 'INSERT INTO benchmark_rows (dataset_id, source_position_id, region, industry, grade, currency, stat_type, value, sample_n) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', args: [datasetId, sourcePosId, region, industry, grade, currency, 'max', maxVal, sampleN] });
        if (avgVal > 0 && avgVal !== p50) stmts.push({ sql: 'INSERT INTO benchmark_rows (dataset_id, source_position_id, region, industry, grade, currency, stat_type, value, sample_n) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', args: [datasetId, sourcePosId, region, industry, grade, currency, 'avg', avgVal, sampleN] });
      } else {
        const val = parseNumber(columnMap.value != null ? row[columnMap.value] : (columnMap.payFrom != null ? row[columnMap.payFrom] : 0));
        const company = columnMap.company != null ? (row[columnMap.company] || '').trim() : null;
        if (val > 0) {
          stmts.push({
            sql: 'INSERT INTO benchmark_rows (dataset_id, source_position_id, region, industry, grade, currency, stat_type, value, sample_n, company) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)',
            args: [datasetId, sourcePosId, region, industry, grade, currency, 'point', val, company]
          });
        }
      }
    }

    if (stmts.length > 0) {
      await batch(stmts);
    }

    return {
      ok: true,
      datasetId,
      datasetTitle,
      insertedRowsCount: stmts.length
    };
  }
}

module.exports = new BenchmarkImportService();
