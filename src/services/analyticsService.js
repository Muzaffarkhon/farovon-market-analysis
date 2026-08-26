const { queryAll, queryOne } = require('../db/database');

function calculateSalaryForkStats(fromSamples, toSamples, midSamples) {
  const n = midSamples.length;
  if (n === 0) return { min: 0, p25: 0, median: 0, p75: 0, max: 0, avg: 0, spread: 0 };

  const validFroms = fromSamples.filter(v => v > 0);
  const validTos = toSamples.filter(v => v > 0);

  // Реальные границы рынка (стандарт C&B)
  const min = validFroms.length ? Math.min(...validFroms) : (validTos.length ? Math.min(...validTos) : Math.min(...midSamples));
  const max = validTos.length ? Math.max(...validTos) : (validFroms.length ? Math.max(...validFroms) : Math.max(...midSamples));

  // Среднее значение
  const avg = Math.round(midSamples.reduce((acc, v) => acc + v, 0) / n);

  // Перцентили и медиана
  const s = [...midSamples].sort((a, b) => a - b);
  const i50 = (n - 1) * 0.5;
  const l50 = Math.floor(i50);
  const median = Math.round(s[l50] + (s[Math.min(l50 + 1, n - 1)] - s[l50]) * (i50 - l50));

  const i25 = (n - 1) * 0.25;
  const l25 = Math.floor(i25);
  const p25 = Math.round(s[l25] + (s[Math.min(l25 + 1, n - 1)] - s[l25]) * (i25 - l25));

  const i75 = (n - 1) * 0.75;
  const l75 = Math.floor(i75);
  const p75 = Math.round(s[l75] + (s[Math.min(l75 + 1, n - 1)] - s[l75]) * (i75 - l75));

  // Реальный размах рынка от Мин до Макс
  const spread = (min > 0 && max > min) ? Math.round(((max - min) / min) * 100) : 0;

  return { min, p25, median, p75, max, avg, spread };
}

async function getExtendedAnalytics(filters = {}) {
  const filterDir = (filters.dir || '').trim();
  const filterHrbp = (filters.hrbp || '').trim();
  const searchPos = (filters.search || '').trim().toLowerCase();

  // 1. Оргструктура
  const divisions = await queryAll('SELECT num, dir, unit, head, resp, hrbp FROM divisions');
  const unitMap = {};
  divisions.forEach(d => {
    unitMap[d.unit] = {
      dir: d.dir || '',
      head: d.head || '',
      resp: d.resp || '',
      hrbp: d.hrbp || '',
      totalComp: 0,
      doneComp: 0,
      askComp: 0,
      surveysCount: 0
    };
  });

  // 2. Конкуренты
  const competitors = await queryAll('SELECT unit, actual FROM competitors');
  competitors.forEach(c => {
    if (unitMap[c.unit]) {
      unitMap[c.unit].totalComp++;
      const act = (c.actual || '').toLowerCase();
      if (act === 'актуально' || act === 'не актуально') {
        unitMap[c.unit].doneComp++;
      } else if (act === 'уточнить') {
        unitMap[c.unit].askComp++;
      }
    }
  });

  // 3. Данные по рынку (Анкеты)
  const surveys = await queryAll("SELECT * FROM surveys WHERE state != 'удалена'");

  let totalRecords = 0;
  let recordsWithSalary = 0;
  const posMap = {};
  const benefitStats = {};
  const bonusStats = { hasBonus: 0, noBonus: 0, unknown: 0, types: {}, periods: {} };
  const compRank = {};
  const curStats = {};

  surveys.forEach(s => {
    const un = s.unit || '';
    const uInfo = unitMap[un] || { dir: '', hrbp: '', resp: '' };

    if (filterDir && uInfo.dir !== filterDir) return;
    if (filterHrbp && uInfo.hrbp !== filterHrbp) return;

    const posOur = (s.pos_our || '').trim();
    const company = (s.company || '').trim();
    const pFrom = Number(s.pay_from) || 0;
    const pTo = Number(s.pay_to) || 0;
    const cur = (s.cur || 'сомони').trim();
    const payPer = (s.pay_per || 'в месяц').trim();
    const bonHas = (s.bon_has || '').trim().toLowerCase();
    const bonSize = (s.bon_size || '').trim();
    const bonType = (s.bon_type || '').trim();
    const bonPer = (s.bon_per || '').trim();
    const benefits = s.benefits ? s.benefits.split(';').map(b => b.trim()).filter(Boolean) : [];
    const note = (s.note || '').trim();

    if (searchPos && !posOur.toLowerCase().includes(searchPos) && !company.toLowerCase().includes(searchPos)) {
      return;
    }

    totalRecords++;
    if (unitMap[un]) unitMap[un].surveysCount++;
    if (company) compRank[company] = (compRank[company] || 0) + 1;
    curStats[cur] = (curStats[cur] || 0) + 1;

    // Бонусы
    if (bonHas === 'да') {
      bonusStats.hasBonus++;
      if (bonType) bonusStats.types[bonType] = (bonusStats.types[bonType] || 0) + 1;
      if (bonPer) bonusStats.periods[bonPer] = (bonusStats.periods[bonPer] || 0) + 1;
    } else if (bonHas === 'нет') {
      bonusStats.noBonus++;
    } else {
      bonusStats.unknown++;
    }

    // Льготы
    benefits.forEach(b => {
      benefitStats[b] = (benefitStats[b] || 0) + 1;
    });

    // Зарплатный анализ
    if (posOur) {
      if (!posMap[posOur]) {
        posMap[posOur] = {
          pos: posOur,
          count: 0,
          fromSamples: [],
          toSamples: [],
          salarySamples: [],
          companies: []
        };
      }
      posMap[posOur].count++;

      let avgPay = 0;
      if (pFrom > 0 || pTo > 0) {
        recordsWithSalary++;
        if (pFrom > 0) posMap[posOur].fromSamples.push(pFrom);
        if (pTo > 0) posMap[posOur].toSamples.push(pTo);
        avgPay = (pFrom > 0 && pTo > 0) ? Math.round((pFrom + pTo) / 2) : (pFrom || pTo);
        posMap[posOur].salarySamples.push(avgPay);
      }

      posMap[posOur].companies.push({
        company,
        unit: un,
        dir: uInfo.dir,
        pFrom,
        pTo,
        avg: avgPay,
        cur,
        payPer,
        bonHas,
        bonSize,
        bonType,
        bonPer,
        benefits,
        note
      });
    }
  });

  // Расчет перцентилей по должностям
  const positionsList = Object.keys(posMap).map(k => {
    const item = posMap[k];
    const stats = calculateSalaryForkStats(item.fromSamples, item.toSamples, item.salarySamples);
    return {
      pos: k,
      count: item.count,
      withSalaryCount: item.salarySamples.length,
      min: stats.min,
      p25: stats.p25,
      median: stats.median,
      p75: stats.p75,
      max: stats.max,
      avg: stats.avg,
      forkSpreadPct: stats.spread,
      companies: item.companies
    };
  }).sort((a, b) => b.count - a.count);

  // Прогресс по HR BP и Дирекциям
  const hrbpGroups = {};
  const dirGroups = {};

  Object.keys(unitMap).forEach(un => {
    const u = unitMap[un];
    const hName = u.hrbp || 'Не назначен';
    const dName = u.dir || 'Без направления';

    if (!hrbpGroups[hName]) {
      hrbpGroups[hName] = { hrbp: hName, unitsTotal: 0, unitsDone: 0, compTotal: 0, compDone: 0, surveysTotal: 0 };
    }
    hrbpGroups[hName].unitsTotal++;
    if (u.totalComp > 0 && u.doneComp === u.totalComp) hrbpGroups[hName].unitsDone++;
    hrbpGroups[hName].compTotal += u.totalComp;
    hrbpGroups[hName].compDone += u.doneComp;
    hrbpGroups[hName].surveysTotal += u.surveysCount;

    if (!dirGroups[dName]) {
      dirGroups[dName] = { dir: dName, unitsTotal: 0, unitsDone: 0, compTotal: 0, compDone: 0, surveysTotal: 0 };
    }
    dirGroups[dName].unitsTotal++;
    if (u.totalComp > 0 && u.doneComp === u.totalComp) dirGroups[dName].unitsDone++;
    dirGroups[dName].compTotal += u.totalComp;
    dirGroups[dName].compDone += u.doneComp;
    dirGroups[dName].surveysTotal += u.surveysCount;
  });

  const hrbpProgress = Object.keys(hrbpGroups).map(k => {
    const g = hrbpGroups[k];
    g.pct = g.compTotal ? Math.round((g.compDone / g.compTotal) * 100) : 0;
    return g;
  }).sort((a, b) => b.pct - a.pct);

  const dirProgress = Object.keys(dirGroups).map(k => {
    const g = dirGroups[k];
    g.pct = g.compTotal ? Math.round((g.compDone / g.compTotal) * 100) : 0;
    return g;
  }).sort((a, b) => b.pct - a.pct);

  // Топ льгот
  const topBenefits = Object.keys(benefitStats).map(k => ({
    name: k,
    count: benefitStats[k],
    pct: totalRecords ? Math.round((benefitStats[k] / totalRecords) * 100) : 0
  })).sort((a, b) => b.count - a.count);

  // Топ компаний
  const topCompetitors = Object.keys(compRank).map(k => ({
    company: k,
    count: compRank[k]
  })).sort((a, b) => b.count - a.count).slice(0, 30);

  const totalDivs = Object.keys(unitMap).length;
  const completedDivs = Object.keys(unitMap).filter(k => unitMap[k].totalComp > 0 && unitMap[k].doneComp === unitMap[k].totalComp).length;
  const totalComps = Object.keys(unitMap).reduce((acc, k) => acc + unitMap[k].totalComp, 0);
  const checkedComps = Object.keys(unitMap).reduce((acc, k) => acc + unitMap[k].doneComp, 0);

  const periodRow = (await queryOne('SELECT * FROM periods ORDER BY id DESC LIMIT 1')) || { name: 'Обзор рынка', state: 'открыт' };

  return {
    ok: true,
    summary: {
      totalDivisions: totalDivs,
      completedDivisions: completedDivs,
      divCompletionPct: totalDivs ? Math.round((completedDivs / totalDivs) * 100) : 0,
      totalCompetitorLinks: totalComps,
      checkedCompetitorLinks: checkedComps,
      compCompletionPct: totalComps ? Math.round((checkedComps / totalComps) * 100) : 0,
      totalSurveyRecords: totalRecords,
      recordsWithSalary: recordsWithSalary,
      positionsCount: positionsList.length
    },
    hrbpProgress,
    dirProgress,
    positions: positionsList,
    topBenefits,
    bonuses: bonusStats,
    topCompetitors,
    currencies: curStats,
    period: {
      name: periodRow.name,
      state: periodRow.state,
      from: periodRow.from_date || '',
      to: periodRow.to_date || '',
      by: periodRow.updated_by || '',
      at: periodRow.updated_at || ''
    }
  };
}

module.exports = {
  calculatePercentiles,
  getExtendedAnalytics
};
