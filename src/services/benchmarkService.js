const { queryAll, queryOne, run, batch } = require('../db/database');
const { getActivePeriod } = require('./periodService');
const { hasCapability } = require('../middleware/auth');
const { summarizeVarPay, parseBonusesCol, isPieceRate } = require('./analyticsService');

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
    return await queryAll('SELECT key, title, kind, is_licensed, default_currency, notes, COALESCE(weight, 100) AS weight, COALESCE(hidden, 0) AS hidden FROM data_sources ORDER BY key');
  }

  /**
   * Веса источников в сводной ставке. weights = { sourceKey: 0..100 }.
   * 0 — источник показывается, но в сводную не входит.
   */
  /**
   * Веса источников для одной должности. weights = { sourceKey: 0..100 | null }.
   * null — убрать свой вес у должности (вернуть общий вес источника).
   */
  async setPositionWeights(positionId, weights, by) {
    const pid = Number(positionId);
    const pos = pid > 0 ? await queryOne('SELECT id FROM dictionary_positions WHERE id = ?', [pid]) : null;
    if (!pos) throw new Error('Должность не найдена в справочнике');
    const known = new Set((await queryAll('SELECT key FROM data_sources')).map(r => r.key));
    const saved = {};
    for (const [key, raw] of Object.entries(weights || {})) {
      if (!known.has(key)) continue;
      if (raw === null || raw === '') {
        await run('DELETE FROM position_source_weights WHERE dict_position_id = ? AND source_key = ?', [pid, key]);
        saved[key] = null;
        continue;
      }
      const w = Math.max(0, Math.min(100, Math.round(Number(raw))));
      if (!Number.isFinite(w)) continue;
      await run(
        `INSERT INTO position_source_weights (dict_position_id, source_key, weight, updated_by, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(dict_position_id, source_key) DO UPDATE SET weight = excluded.weight, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
        [pid, key, w, by || null]
      );
      saved[key] = w;
    }
    return saved;
  }

  async setSourceWeights(weights) {
    const known = new Set((await queryAll('SELECT key FROM data_sources')).map(r => r.key));
    const saved = {};
    for (const [key, raw] of Object.entries(weights || {})) {
      if (!known.has(key)) continue;
      const w = Math.max(0, Math.min(100, Math.round(Number(raw))));
      if (!Number.isFinite(w)) continue;
      await run('UPDATE data_sources SET weight = ? WHERE key = ?', [w, key]);
      saved[key] = w;
    }
    return saved;
  }

  /**
   * Создать новый источник данных
   */
  async createSource({ key, title, kind, isLicensed, defaultCurrency, notes }) {
    if (!key || !title) {
      throw new Error('Укажите ключ и название источника');
    }
    const cleanKey = String(key).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const existing = await queryOne('SELECT key FROM data_sources WHERE key = ?', [cleanKey]);
    if (existing) {
      throw new Error(`Источник с кодом «${cleanKey}» уже зарегистрирован`);
    }
    await run(
      'INSERT INTO data_sources (key, title, kind, is_licensed, default_currency, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [cleanKey, title.trim(), kind || 'consultancy', isLicensed ? 1 : 0, defaultCurrency || 'сомони', notes || '']
    );
    return await queryOne('SELECT * FROM data_sources WHERE key = ?', [cleanKey]);
  }

  /**
   * Изменить источник: название, тип, валюту, лицензию, примечание, скрытие.
   * Код источника не меняется. «Внутренний сбор» править и скрывать нельзя.
   */
  async updateSource(key, patch) {
    const src = await queryOne('SELECT key FROM data_sources WHERE key = ?', [String(key || '')]);
    if (!src) throw new Error('Источник не найден');
    if (src.key === 'internal') throw new Error('Внутренний сбор нельзя изменить или скрыть');
    const sets = [];
    const args = [];
    if (patch.title !== undefined) {
      const t = String(patch.title || '').trim();
      if (!t) throw new Error('Название источника не может быть пустым');
      sets.push('title = ?'); args.push(t);
    }
    if (patch.kind !== undefined) { sets.push('kind = ?'); args.push(String(patch.kind || 'consultancy')); }
    if (patch.defaultCurrency !== undefined) { sets.push('default_currency = ?'); args.push(String(patch.defaultCurrency || 'сомони')); }
    if (patch.isLicensed !== undefined) { sets.push('is_licensed = ?'); args.push(patch.isLicensed ? 1 : 0); }
    if (patch.notes !== undefined) { sets.push('notes = ?'); args.push(String(patch.notes || '')); }
    if (patch.hidden !== undefined) { sets.push('hidden = ?'); args.push(patch.hidden ? 1 : 0); }
    if (sets.length) await run('UPDATE data_sources SET ' + sets.join(', ') + ' WHERE key = ?', [...args, src.key]);
    return await queryOne('SELECT key, title, kind, is_licensed, default_currency, notes, COALESCE(weight, 100) AS weight, COALESCE(hidden, 0) AS hidden FROM data_sources WHERE key = ?', [src.key]);
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
    const numId = Number(positionId);
    if (positionId && !isNaN(numId) && numId > 0) {
      posRow = await queryOne('SELECT id, name, pay_from, pay_to FROM dictionary_positions WHERE id = ?', [numId]);
    }
    const cleanName = String(positionName || '').trim();
    if (!posRow && cleanName && cleanName !== 'undefined' && cleanName !== 'null') {
      posRow = await queryOne('SELECT id, name, pay_from, pay_to FROM dictionary_positions WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))', [cleanName]);
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

    // 1. Проекция внутреннего сбора (таблица surveys) — только текущий год
    // сбора, тем же образом, что дашборд и форма заполнения (см. docs/
    // superpowers/specs/2026-09-04-yearly-archive-design.md): без этого
    // сравнение «мы vs рынок» тихо смешивало бы все года подряд, пока
    // дашборд уже умеет их различать.
    const currentPeriod = await getActivePeriod();
    const survRows = await queryAll(`
      SELECT pay_from, pay_to, cur, company, pay_per,
             bon_has, bon_size, bon_type, bon_per, bonuses
      FROM surveys
      WHERE state != 'удалена' AND LOWER(TRIM(pos_our)) = LOWER(TRIM(?)) AND period_id = ?
    `, [ourPosName, currentPeriod ? currentPeriod.id : null]);

    const internalValues = [];
    // Совокупный доход = оклад + переменная часть, приведённая к месяцу. В
    // выборку попадает КАЖДАЯ запись с окладом: если премию посчитать нельзя
    // (нет данных / размер словами) — берётся только оклад, запись не теряется.
    const internalTotalValues = [];
    let bonusQuantifiedCount = 0;
    survRows.forEach(r => {
      // Сдельная ставка за услугу несопоставима с месячным окладом Фаровона —
      // в перцентили внутреннего сбора её не берём (как и на дашборде).
      if (isPieceRate(r.pay_per)) return;
      const pF = Number(r.pay_from || 0);
      const pT = Number(r.pay_to || 0);
      const mid = (pF > 0 && pT > 0) ? (pF + pT) / 2 : (pF || pT || 0);
      if (mid <= 0) return;
      internalValues.push(mid);
      // Один канонический разбор премий (тот же, что на дашборде) — иначе
      // «Совокупный доход» здесь и «Совокупно» в вилках расходятся.
      const bonusArr = parseBonusesCol(r.bonuses, r.bon_type, r.bon_size, r.bon_per);
      const vp = summarizeVarPay(bonusArr, r.bon_has, mid);
      if (vp.monthly != null) bonusQuantifiedCount++;
      internalTotalValues.push(mid + (vp.monthly || 0));
    });

    const internalStats = calculatePercentiles(internalValues);
    const internalTotalStats = calculatePercentiles(internalTotalValues);

    // 2. Внешние источники через position_map
    const mappedSources = await queryAll(`
      SELECT pm.confidence, pm.note AS map_note,
             sp.id AS source_position_id, sp.source_key, sp.code AS source_code, sp.label AS source_label, sp.family,
             ds.title AS source_title, ds.kind AS source_kind, ds.is_licensed, ds.default_currency,
             COALESCE(ds.weight, 100) AS weight
      FROM position_map pm
      JOIN source_positions sp ON pm.source_position_id = sp.id
      JOIN data_sources ds ON sp.source_key = ds.key
      WHERE pm.dict_position_id = ? AND COALESCE(ds.hidden, 0) = 0
    `, [dictPosId]);

    const externalBenchmarks = [];
    // Участники сводной ставки: { key, weight, stats }. Сводная — взвешенное
    // среднее каждого перцентиля по источникам с данными (market composite,
    // как в CompAnalyst/MarketPay); вес — у источника, а не у должности.
    const compositeParts = [];
    // Вес по должности (если задан) перекрывает общий вес источника.
    const posWeightRows = await queryAll('SELECT source_key, weight FROM position_source_weights WHERE dict_position_id = ?', [dictPosId]);
    const posWeights = {};
    posWeightRows.forEach(r => { posWeights[r.source_key] = Number(r.weight); });
    const weightOf = (key, globalW) => (posWeights[key] != null ? posWeights[key] : globalW);
    const internalWeightRow = await queryOne("SELECT COALESCE(weight, 100) AS weight FROM data_sources WHERE key = 'internal'");
    const internalGlobalWeight = internalWeightRow ? Number(internalWeightRow.weight) : 100;
    const internalWeight = weightOf('internal', internalGlobalWeight);
    if (internalStats.count > 0 && internalStats.p50 > 0) {
      compositeParts.push({ key: 'internal', weight: internalWeight, stats: internalStats });
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
        compositeParts.push({ key: src.source_key, weight: weightOf(src.source_key, Number(src.weight)), stats });
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
        gapAmount,
        weight: weightOf(src.source_key, Number(src.weight)),
        globalWeight: Number(src.weight),
        positionWeight: posWeights[src.source_key] != null,
        compaRatio: (ourMid > 0 && stats.p50 > 0) ? Math.round(ourMid / stats.p50 * 100) / 100 : null
      });
    }

    // Сводная рыночная ставка (market composite): взвешенное среднее каждого
    // перцентиля. Источник с весом 0 показывается, но в сводную не входит.
    // Если у всех участников вес 0 — считаем поровну, иначе сводной не будет.
    const active = compositeParts.filter(p => p.weight > 0);
    const parts = active.length ? active : compositeParts.map(p => ({ ...p, weight: 1 }));
    const wSum = parts.reduce((a, p) => a + p.weight, 0);
    const shares = {};
    parts.forEach(p => { shares[p.key] = wSum ? p.weight / wSum : 0; });
    const compositeStats = {};
    ['p10', 'p25', 'p50', 'p75', 'p90'].forEach(k => {
      // Перцентиль берём только у тех, у кого он есть, с перенормировкой весов
      // — иначе источник без P10 тянул бы сводную P10 к нулю.
      const have = parts.filter(p => Number(p.stats[k]) > 0);
      const w = have.reduce((a, p) => a + p.weight, 0);
      compositeStats[k] = w ? Math.round(have.reduce((a, p) => a + Number(p.stats[k]) * p.weight, 0) / w) : 0;
    });
    const compositeMedian = compositeStats.p50 || 0;
    let compositeGapPercent = null;
    let compositeGapAmount = null;
    let compaRatio = null;
    if (ourMid > 0 && compositeMedian > 0) {
      compositeGapAmount = Math.round(ourMid - compositeMedian);
      compositeGapPercent = Math.round(((ourMid - compositeMedian) / compositeMedian) * 1000) / 10;
      compaRatio = Math.round(ourMid / compositeMedian * 100) / 100;
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
        // Считаем только те анкеты, что реально попали в перцентили: сдельные
        // ставки исключены, и «N набл.» рядом с вилкой не должно их обещать.
        observationsCount: internalValues.length,
        stats: internalStats,
        // Совокупный доход (оклад + переменная часть/мес.) — вторая карточка.
        totalStats: internalTotalStats,
        totalBonusCount: bonusQuantifiedCount,
        totalSampleCount: internalTotalValues.length,
        gapPercent: (ourMid > 0 && internalStats.p50 > 0) ? Math.round(((ourMid - internalStats.p50) / internalStats.p50) * 100) : null,
        gapAmount: (ourMid > 0 && internalStats.p50 > 0) ? Math.round(ourMid - internalStats.p50) : null,
        weight: internalWeight,
        globalWeight: internalGlobalWeight,
        positionWeight: posWeights.internal != null,
        share: shares.internal || 0,
        compaRatio: (ourMid > 0 && internalStats.p50 > 0) ? Math.round(ourMid / internalStats.p50 * 100) / 100 : null
      },
      external: externalBenchmarks.map(e => ({ ...e, share: e.hasData ? (shares[e.sourceKey] || 0) : 0 })),
      summary: {
        sourcesCount: parts.length,
        compositeMedian,
        compositeStats,
        compositeGapPercent,
        compositeGapAmount,
        compaRatio
      }
    };
  }

  /**
   * Удаление датасета и его строк
   */
  async deleteDataset(id) {
    const dsId = Number(id);
    await batch([
      { sql: 'DELETE FROM benchmark_rows WHERE dataset_id = ?', args: [dsId] },
      { sql: 'DELETE FROM benchmark_datasets WHERE id = ?', args: [dsId] }
    ]);
    return { ok: true };
  }

  /**
   * Экспорт матрицы бенчмаркинга в CSV
   */
  async exportMatrix({ user }) {
    let positions = await queryAll(`
      SELECT DISTINCT d.id, d.name, d.pay_from, d.pay_to
      FROM dictionary_positions d
      WHERE d.id IN (SELECT dict_position_id FROM position_map)
      ORDER BY d.name ASC
    `);

    if (!positions || positions.length === 0) {
      positions = await queryAll(`
        SELECT d.id, d.name, d.pay_from, d.pay_to
        FROM dictionary_positions d
        WHERE d.pay_from > 0 OR d.pay_to > 0
        ORDER BY d.name ASC LIMIT 50
      `);
    }

    const rows = [];
    for (const pos of positions) {
      try {
        const comp = await this.compare({ positionId: pos.id, user });
        const p = comp.position;
        const intr = comp.internal.stats;
        const intrTot = comp.internal.totalStats || {};
        const extMap = {};
        comp.external.forEach(e => { extMap[e.sourceKey] = e; });
        const b1 = extMap['b1'] ? extMap['b1'].stats : {};
        const antal = extMap['antal'] ? extMap['antal'].stats : {};
        const job = extMap['job_farovon'] ? extMap['job_farovon'].stats : {};
        const sum = comp.summary;

        rows.push({
          position: p.name,
          ourFrom: p.ourPayFrom || '',
          ourTo: p.ourPayTo || '',
          ourMid: p.ourMid || '',
          internalP50: intr.p50 || '',
          internalTotalP50: intrTot.p50 || '',
          b1P50: b1.p50 || '',
          antalP50: antal.p50 || '',
          jobP50: job.p50 || '',
          compositeMedian: sum.compositeMedian || '',
          gapPercent: sum.compositeGapPercent != null ? (sum.compositeGapPercent + '%') : '',
          gapAmount: sum.compositeGapAmount != null ? sum.compositeGapAmount : ''
        });
      } catch (e) {}
    }

    const headers = [
      'Должность',
      'Оклад Фаровон (От)',
      'Оклад Фаровон (До)',
      'Медиана Фаровон',
      'Внутренний сбор (P50)',
      'Совокупный доход (P50)',
      'B1 Ernst & Young (P50)',
      'Antal International (P50)',
      'Job Farovon (P50)',
      'Сводная медиана рынка',
      'Гэп к рынку (%)',
      'Гэп к рынку (сомони)'
    ];

    const escapeCsv = (val) => {
      const s = String(val == null ? '' : val).replace(/"/g, '""');
      return `"${s}"`;
    };

    const csvLines = [
      '\uFEFF' + headers.map(escapeCsv).join(';')
    ];

    rows.forEach(r => {
      csvLines.push([
        r.position,
        r.ourFrom,
        r.ourTo,
        r.ourMid,
        r.internalP50,
        r.internalTotalP50,
        r.b1P50,
        r.antalP50,
        r.jobP50,
        r.compositeMedian,
        r.gapPercent,
        r.gapAmount
      ].map(escapeCsv).join(';'));
    });

    return csvLines.join('\r\n');
  }

  /**
   * Сводные виджеты для главного дашборда
   */
  async getBenchmarkSummaryWidgets({ user }) {
    const totalRow = await queryOne('SELECT COUNT(*) as total FROM dictionary_positions');
    const targetPositions = await queryAll(`
      SELECT DISTINCT d.id, d.name, d.pay_from, d.pay_to
      FROM dictionary_positions d
      WHERE d.id IN (SELECT dict_position_id FROM position_map)
    `);

    const gaps = [];
    let mappedCount = 0;

    for (const pos of targetPositions) {
      try {
        const comp = await this.compare({ positionId: pos.id, user });
        if (comp.summary.compositeMedian > 0) {
          mappedCount++;
          if (comp.summary.compositeGapPercent != null) {
            gaps.push({
              positionId: pos.id,
              positionName: pos.name,
              ourMid: comp.position.ourMid,
              marketMedian: comp.summary.compositeMedian,
              gapPercent: comp.summary.compositeGapPercent,
              gapAmount: comp.summary.compositeGapAmount
            });
          }
        }
      } catch (e) {}
    }

    gaps.sort((a, b) => a.gapPercent - b.gapPercent);
    const belowMarket = gaps.filter(g => g.gapPercent < 0).slice(0, 5);
    const aboveMarket = gaps.filter(g => g.gapPercent > 0).slice(-5).reverse();

    const totalPositions = (totalRow && totalRow.total) || 0;
    const coveragePercent = totalPositions > 0 ? Math.round((mappedCount / totalPositions) * 100) : 0;

    return {
      totalPositions,
      mappedPositions: mappedCount,
      coveragePercent,
      belowMarket,
      aboveMarket
    };
  }
}

module.exports = new BenchmarkService();
