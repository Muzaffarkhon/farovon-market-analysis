const { queryAll, queryOne, run, batch } = require('../db/database');
const { hasCapability } = require('../middleware/auth');

/**
 * Расчет перцентилей по массиву чисел (P10, P25, P50/медиана, P75, P90, min, max, avg).
 */
function calculatePercentiles(values) {
  if (!values || values.length === 0) {
    return { count: 0, min: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, max: 0, avg: 0 };
  }
  const nums = values.slice().sort((a, b) => a - b);
  const n = nums.length;
  const sum = nums.reduce((acc, v) => acc + v, 0);

  function getP(p) {
    if (n === 1) return nums[0];
    const rank = p * (n - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    const weight = rank - low;
    return nums[low] * (1 - weight) + nums[high] * weight;
  }

  return {
    count: n,
    min: Math.round(nums[0]),
    p10: Math.round(getP(0.10)),
    p25: Math.round(getP(0.25)),
    p50: Math.round(getP(0.50)),
    p75: Math.round(getP(0.75)),
    p90: Math.round(getP(0.90)),
    max: Math.round(nums[n - 1]),
    avg: Math.round(sum / n)
  };
}

/**
 * Нечеткая похожесть двух строк (коэффициент Сёренсена-Дайса по биграммам)
 */
function stringSimilarity(s1, s2) {
  const norm1 = String(s1 || '').trim().toLowerCase().replace(/[^a-zа-яё0-9]/g, '');
  const norm2 = String(s2 || '').trim().toLowerCase().replace(/[^a-zа-яё0-9]/g, '');
  if (!norm1 || !norm2) return 0;
  if (norm1 === norm2) return 1;
  if (norm1.length < 2 || norm2.length < 2) return norm1 === norm2 ? 1 : 0;

  const bg1 = new Map();
  for (let i = 0; i < norm1.length - 1; i++) {
    const bg = norm1.substr(i, 2);
    bg1.set(bg, (bg1.get(bg) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < norm2.length - 1; i++) {
    const bg = norm2.substr(i, 2);
    const count = bg1.get(bg) || 0;
    if (count > 0) {
      bg1.set(bg, count - 1);
      intersection++;
    }
  }

  return (2.0 * intersection) / (norm1.length - 1 + norm2.length - 1);
}

class BenchmarkService {
  /**
   * Получить список всех источников данных
   */
  async getSources() {
    return await queryAll('SELECT key, title, kind, is_licensed, default_currency, notes FROM data_sources ORDER BY key');
  }

  /**
   * Получить список датасетов
   */
  async getDatasets(filter = {}) {
    let sql = `
      SELECT d.*, s.title AS source_title, s.kind AS source_kind, s.is_licensed
      FROM benchmark_datasets d
      JOIN data_sources s ON d.source_key = s.key
      WHERE 1=1
    `;
    const params = [];
    if (filter.sourceKey) {
      sql += ' AND d.source_key = ?';
      params.push(filter.sourceKey);
    }
    if (filter.state) {
      sql += ' AND d.state = ?';
      params.push(filter.state);
    }
    sql += ' ORDER BY d.uploaded_at DESC, d.id DESC';
    return await queryAll(sql, params);
  }

  /**
   * Получить позиции конкретного источника
   */
  async getSourcePositions(sourceKey) {
    const sql = `
      SELECT sp.*, COUNT(pm.id) AS mapped_count
      FROM source_positions sp
      LEFT JOIN position_map pm ON sp.id = pm.source_position_id
      WHERE sp.source_key = ?
      GROUP BY sp.id
      ORDER BY sp.label ASC
    `;
    return await queryAll(sql, [sourceKey]);
  }

  /**
   * Получить маппинги для должностей Фаровона
   */
  async getMappings(sourceKey = null) {
    let sql = `
      SELECT pm.id, pm.confidence, pm.note, pm.mapped_by, pm.mapped_at,
             dp.id AS dict_position_id, dp.name AS dict_position_name, dp.pay_from AS our_pay_from, dp.pay_to AS our_pay_to,
             sp.id AS source_position_id, sp.source_key, sp.code AS source_code, sp.label AS source_label, sp.family AS source_family,
             ds.title AS source_title, ds.is_licensed
      FROM position_map pm
      JOIN dictionary_positions dp ON pm.dict_position_id = dp.id
      JOIN source_positions sp ON pm.source_position_id = sp.id
      JOIN data_sources ds ON sp.source_key = ds.key
    `;
    const params = [];
    if (sourceKey) {
      sql += ' WHERE sp.source_key = ?';
      params.push(sourceKey);
    }
    sql += ' ORDER BY dp.name ASC, ds.title ASC';
    return await queryAll(sql, params);
  }

  /**
   * Предложения по сопоставлению должностей на основе похожести названий
   */
  async suggestMappings(sourceKey) {
    const dictPositions = await queryAll('SELECT id, name FROM dictionary_positions ORDER BY name');
    const sourcePositions = await queryAll(`
      SELECT sp.id, sp.label, sp.code, sp.family
      FROM source_positions sp
      WHERE sp.source_key = ? AND sp.id NOT IN (SELECT source_position_id FROM position_map)
      ORDER BY sp.label
    `, [sourceKey]);

    const suggestions = [];
    for (const sp of sourcePositions) {
      let bestMatch = null;
      let highestScore = 0;

      for (const dp of dictPositions) {
        const score = stringSimilarity(sp.label, dp.name);
        if (score > highestScore && score >= 0.45) {
          highestScore = score;
          bestMatch = dp;
        }
      }

      if (bestMatch) {
        suggestions.push({
          sourcePosition: sp,
          suggestedDictPosition: bestMatch,
          similarity: Math.round(highestScore * 100),
          confidence: highestScore >= 0.85 ? 'exact' : (highestScore >= 0.65 ? 'close' : 'approx')
        });
      }
    }

    return suggestions.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Сохранить сопоставление
   */
  async saveMapping({ dictPositionId, sourcePositionId, confidence = 'exact', note = '', mappedBy = '' }) {
    if (!dictPositionId || !sourcePositionId) {
      throw new Error('Укажите ID эталонной должности и ID должности источника');
    }
    await run(`
      INSERT INTO position_map (dict_position_id, source_position_id, confidence, note, mapped_by, mapped_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(dict_position_id, source_position_id) DO UPDATE SET
        confidence = excluded.confidence,
        note = excluded.note,
        mapped_by = excluded.mapped_by,
        mapped_at = CURRENT_TIMESTAMP
    `, [dictPositionId, sourcePositionId, confidence, note, mappedBy]);

    return { ok: true };
  }

  /**
   * Удалить сопоставление
   */
  async deleteMapping(id) {
    await run('DELETE FROM position_map WHERE id = ?', [id]);
    return { ok: true };
  }

  /**
   * Главный метод сравнения вознаграждений по должности:
   * сводит данные Фаровона, внутреннего сбора (surveys) и внешних датасетов.
   */
  async compare({ positionId, positionName, user }) {
    let posRow = null;
    if (positionId) {
      posRow = await queryOne('SELECT id, name, pay_from, pay_to FROM dictionary_positions WHERE id = ?', [positionId]);
    } else if (positionName) {
      posRow = await queryOne('SELECT id, name, pay_from, pay_to FROM dictionary_positions WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))', [positionName]);
    }

    if (!posRow) {
      throw new Error('Должность не найдена в справочнике');
    }

    const dictPosId = posRow.id;
    const ourPosName = posRow.name;
    const ourPayFrom = Number(posRow.pay_from || 0);
    const ourPayTo = Number(posRow.pay_to || 0);
    const ourMid = (ourPayFrom > 0 && ourPayTo > 0) ? (ourPayFrom + ourPayTo) / 2 : (ourPayFrom || ourPayTo || 0);

    const canViewLicensed = user && (user.role === 'admin' || (await hasCapability(user, 'benchmarks:view_licensed')));

    // 1. Проекция внутреннего сбора (таблица surveys)
    const survRows = await queryAll(`
      SELECT pay_from, pay_to, cur, company
      FROM surveys
      WHERE state != 'удалена' AND LOWER(TRIM(pos_our)) = LOWER(TRIM(?))
    `, [ourPosName]);

    const internalValues = [];
    survRows.forEach(r => {
      const pF = Number(r.pay_from || 0);
      const pT = Number(r.pay_to || 0);
      const mid = (pF > 0 && pT > 0) ? (pF + pT) / 2 : (pF || pT || 0);
      if (mid > 0) internalValues.push(mid);
    });

    const internalStats = calculatePercentiles(internalValues);

    // 2. Внешние источники через position_map
    const mappedSources = await queryAll(`
      SELECT pm.confidence, pm.note AS map_note,
             sp.id AS source_position_id, sp.source_key, sp.code AS source_code, sp.label AS source_label, sp.family,
             ds.title AS source_title, ds.kind AS source_kind, ds.is_licensed, ds.default_currency
      FROM position_map pm
      JOIN source_positions sp ON pm.source_position_id = sp.id
      JOIN data_sources ds ON sp.source_key = ds.key
      WHERE pm.dict_position_id = ?
    `, [dictPosId]);

    const externalBenchmarks = [];
    const allMarketMedians = [];
    if (internalStats.count > 0 && internalStats.p50 > 0) {
      allMarketMedians.push(internalStats.p50);
    }

    for (const src of mappedSources) {
      if (src.is_licensed && !canViewLicensed) {
        continue;
      }

      // Находим строки из активных датасетов
      const rows = await queryAll(`
        SELECT br.*, bd.title AS dataset_title, bd.data_as_of, bd.report_date
        FROM benchmark_rows br
        JOIN benchmark_datasets bd ON br.dataset_id = bd.id
        WHERE br.source_position_id = ? AND bd.state = 'active'
        ORDER BY bd.data_as_of DESC, br.id ASC
      `, [src.source_position_id]);

      if (!rows || rows.length === 0) {
        externalBenchmarks.push({
          sourceKey: src.source_key,
          sourceTitle: src.source_title,
          sourceKind: src.source_kind,
          isLicensed: !!src.is_licensed,
          sourcePosition: src.source_label,
          sourceCode: src.source_code,
          confidence: src.confidence,
          hasData: false,
          stats: null,
          gapPercent: null,
          gapAmount: null
        });
        continue;
      }

      // Если данные точечные (сырые вакансии)
      const pointRows = rows.filter(r => r.stat_type === 'point');
      let stats = {};
      let dataAsOf = rows[0].data_as_of || rows[0].report_date || '';

      if (pointRows.length > 0) {
        const pointValues = pointRows.map(r => Number(r.value || 0)).filter(v => v > 0);
        stats = calculatePercentiles(pointValues);
      } else {
        // Данные в готовых перцентилях (B1, Antal)
        const statMap = {};
        let totalN = 0;
        rows.forEach(r => {
          statMap[r.stat_type] = Number(r.value || 0);
          if (r.sample_n) totalN = Math.max(totalN, r.sample_n);
        });

        stats = {
          count: totalN || 1,
          min: statMap['min'] || statMap['p10'] || 0,
          p10: statMap['p10'] || 0,
          p25: statMap['p25'] || statMap['min'] || 0,
          p50: statMap['p50'] || statMap['avg'] || 0,
          p75: statMap['p75'] || statMap['max'] || 0,
          p90: statMap['p90'] || 0,
          max: statMap['max'] || statMap['p90'] || 0,
          avg: statMap['avg'] || statMap['p50'] || 0
        };
      }

      if (stats.p50 > 0) {
        allMarketMedians.push(stats.p50);
      }

      let gapPercent = null;
      let gapAmount = null;
      if (ourMid > 0 && stats.p50 > 0) {
        gapAmount = Math.round(ourMid - stats.p50);
        gapPercent = Math.round(((ourMid - stats.p50) / stats.p50) * 100);
      }

      externalBenchmarks.push({
        sourceKey: src.source_key,
        sourceTitle: src.source_title,
        sourceKind: src.source_kind,
        isLicensed: !!src.is_licensed,
        sourcePosition: src.source_label,
        sourceCode: src.source_code,
        confidence: src.confidence,
        dataAsOf,
        hasData: true,
        stats,
        gapPercent,
        gapAmount
      });
    }

    // Сводная рыночная медиана (Composite Market Median)
    let compositeMedian = 0;
    let compositeGapPercent = null;
    let compositeGapAmount = null;

    if (allMarketMedians.length > 0) {
      compositeMedian = Math.round(allMarketMedians.reduce((a, b) => a + b, 0) / allMarketMedians.length);
      if (ourMid > 0 && compositeMedian > 0) {
        compositeGapAmount = Math.round(ourMid - compositeMedian);
        compositeGapPercent = Math.round(((ourMid - compositeMedian) / compositeMedian) * 100);
      }
    }

    return {
      position: {
        id: dictPosId,
        name: ourPosName,
        ourPayFrom,
        ourPayTo,
        ourMid
      },
      internal: {
        sourceKey: 'internal',
        sourceTitle: 'Внутренний сбор',
        sourceKind: 'internal',
        observationsCount: survRows.length,
        stats: internalStats,
        gapPercent: (ourMid > 0 && internalStats.p50 > 0) ? Math.round(((ourMid - internalStats.p50) / internalStats.p50) * 100) : null,
        gapAmount: (ourMid > 0 && internalStats.p50 > 0) ? Math.round(ourMid - internalStats.p50) : null
      },
      external: externalBenchmarks,
      summary: {
        sourcesCount: allMarketMedians.length,
        compositeMedian,
        compositeGapPercent,
        compositeGapAmount
      }
    };
  }
}

module.exports = new BenchmarkService();
