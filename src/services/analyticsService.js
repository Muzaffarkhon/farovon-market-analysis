const { queryAll, queryOne } = require('../db/database');

// Стандартный месяц для приведения часовой тарифной ставки (ЧТС) к месячному
// окладу: 168 часов. Нужно, чтобы часовые ставки не занижали вилки должностей.
const HOURS_PER_MONTH = 168;

/** Похоже ли наблюдение на часовую ставку (ЧТС). Признаки:
 *  - периодичность прямо говорит «в час» / «ЧТС»;
 *  - «месячный» оклад меньше 1000 сомони — такого на рынке нет, это ЧТС,
 *    внесённая без смены периодичности (8,5 / 20 / 230 …). */
function looksHourly(payPer, pFrom, pTo) {
  if (/час|чтс/i.test(payPer || '')) return true;
  const v = pFrom || pTo || 0;
  return v > 0 && v < 1000;
}

/** ЧТС → месячный эквивалент (× 168). Прочие значения не трогаем. */
function toMonthly(value, hourly) {
  return (hourly && value > 0) ? Math.round(value * HOURS_PER_MONTH) : value;
}

// ─── Переменная часть (премии) ──────────────────────────────────────────────
// В сборе данных по компании теперь несколько видов премии сразу:
// surveys.bonuses = JSON '[{type,size,per}]'. Колонки bon_* держат первый вид
// (обратная совместимость). Здесь: разбор строки, свёртка в один показатель
// для ячейки дашборда и приведение к месячной сумме для колонки «Совокупно».

function declRu(n, forms) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
  return forms[2];
}

function fmtNum(n) {
  const num = Number(n);
  if (!isFinite(num)) return '0';
  // toLocaleString('ru-RU') — тот же неразрывный пробел-разделитель тысяч, что
  // и у остальных чисел в приложении (не ASCII-пробел).
  return Math.round(num * 10) / 10 === Math.round(num)
    ? Math.round(num).toLocaleString('ru-RU')
    : num.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

/** surveys.bonuses (строка/массив) → чистый массив [{type,size,per}].
 *  Пусто → синтезируем один вид из плоских bon_* (старые записи). */
function parseBonusesCol(raw, bonType, bonSize, bonPer) {
  let arr = raw;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch (_) { arr = []; }
  }
  if (!Array.isArray(arr)) arr = [];
  const out = arr
    .filter(b => b && typeof b === 'object')
    .map(b => ({
      type: String(b.type || '').trim(),
      size: String(b.size == null ? '' : b.size).trim(),
      per: String(b.per || '').trim()
    }))
    .filter(b => b.type || b.size || b.per);
  if (out.length) return out;
  const t = String(bonType || '').trim();
  const s = String(bonSize || '').trim();
  const p = String(bonPer || '').trim();
  return (t || s || p) ? [{ type: t, size: s, per: p }] : [];
}

/** Размер премии — свободный текст. «20» → 20% от оклада, «3000» → сумма в c,
 *  «1 оклад» → кратно окладу, прочее → не распознано.
 *  Пробел/запятая/точка — разделители тысяч («50 000», «50.000», «50,000»):
 *  сначала выкидываем их, потом разбираем число (иначе «50 000» читалось как 50).
 *  Порог 100 без явной единицы: на рынке нет премий «в сомони» меньше сотни. */
function parseBonusSize(raw) {
  const t = String(raw == null ? '' : raw)
    .trim().toLowerCase()
    .replace(/[\s   ]/g, '') // разделители тысяч и nbsp
    .replace(/[.,](?=\d{3}(\D|$))/g, '')    // «50.000» / «50,000» → «50000»
    .replace(/,/g, '.');                    // остаток запятой — десятичный разделитель
  if (!t) return { kind: 'unknown', value: 0 };
  if (/оклад|зарплат|з\/п|зп/.test(t)) {
    const m = t.match(/[\d.]+/);
    return { kind: 'salary', value: m ? Math.max(0.1, parseFloat(m[0])) : 1 };
  }
  const m = t.match(/-?[\d.]+/);
  if (!m) return { kind: 'unknown', value: 0 };
  const v = parseFloat(m[0]);
  if (!isFinite(v) || v <= 0) return { kind: 'unknown', value: 0 };
  if (/%|проц/.test(t)) return { kind: 'pct', value: v };
  if (/c$|с$|сом|tjs|руб|\$|usd/.test(t) || v > 100) return { kind: 'abs', value: v };
  return { kind: 'pct', value: v }; // число ≤100 без единицы — процент
}

/** Периодичность → доля месяца (годовой бонус ÷12 и т.д.). Принимает как
 *  нормализованные значения (normPeriod), так и сырые/английские. */
function perToMonthlyFactor(per) {
  const p = String(per || '').toLowerCase();
  if (/квартал|quarter/.test(p)) return 1 / 3;
  if (/полугод|полгода|semi.?annual|half.?year/.test(p)) return 1 / 6;
  if (/год|ежегод|annual|year/.test(p)) return 1 / 12;
  if (/разов|единовремен|однократ|one.?time/.test(p)) return 1 / 12; // разовый — амортизируем на год
  if (/недел|week/.test(p)) return 4.33;
  if (/дн|day/.test(p)) return 21;
  return 1; // в месяц / ежемесячно / monthly / не указано
}

/** Единый словарь периодичности: старые анкеты писали «Месячный / Годовой /
 *  Квартальный», новая форма — «в месяц / в квартал / в полугодие / в год /
 *  разово». Сводим к значениям формы. Незнакомое оставляем как есть. */
function normPeriod(per) {
  const p = String(per || '').trim().toLowerCase();
  if (!p) return '';
  if (/квартал/.test(p)) return 'в квартал';
  if (/полугод|полгода/.test(p)) return 'в полугодие';
  if (/разов|единовремен|однократ/.test(p)) return 'разово';
  if (/год|ежегод|annual/.test(p)) return 'в год';
  if (/недел/.test(p)) return 'в неделю';
  if (/меся[цч]|monthly|ежемес/.test(p)) return 'в месяц';
  return String(per).trim();
}

/**
 * Свёртка переменной части одной компании в показатель для дашборда.
 * @returns {{has:boolean, label:string, kinds:Array, monthly:(number|null), topPer:string}}
 *  label   — короткая пометка в ячейку («2 вида · ≈ 22%» | «годовой · 3 000 c» |
 *            «без премии» | «не указано» | '');
 *  monthly — премия, приведённая к месяцу в валюте строки (null — если размеры
 *            не распознаны); нужна для колонки «Совокупно».
 */
function summarizeVarPay(list, bonHas, avgMonthly) {
  const kinds = (Array.isArray(list) ? list : []).map(b => ({
    type: String(b.type || '').trim(),
    size: String(b.size == null ? '' : b.size).trim(),
    per: normPeriod(b.per),
    parsed: parseBonusSize(b.size)
  })).filter(k => k.type || k.size || k.per);

  let monthly = 0;
  let monthlyKnown = false;
  kinds.forEach(k => {
    const f = perToMonthlyFactor(k.per);
    let m = null;
    if (k.parsed.kind === 'pct' && avgMonthly > 0) m = avgMonthly * (k.parsed.value / 100) * f;
    else if (k.parsed.kind === 'abs') m = k.parsed.value * f;
    else if (k.parsed.kind === 'salary' && avgMonthly > 0) m = avgMonthly * k.parsed.value * f;
    if (m != null && isFinite(m)) { monthly += m; monthlyKnown = true; }
  });

  const hh = String(bonHas || '').trim().toLowerCase();
  let label = '';
  let has = false;
  if (!kinds.length) {
    if (hh === 'да') { label = 'не указано'; has = true; }
    else if (hh === 'нет') { label = 'без премии'; has = false; }
  } else {
    // Явное «нет» при заполненных видах — противоречие в данных; доверяем видам.
    has = true;
    if (kinds.length === 1) {
      const k = kinds[0];
      let sz = null;
      if (k.parsed.kind === 'pct') sz = fmtNum(k.parsed.value) + '%';
      else if (k.parsed.kind === 'abs') sz = fmtNum(k.parsed.value) + ' c';
      else if (k.parsed.kind === 'salary') sz = fmtNum(k.parsed.value) + ' ' + declRu(Math.round(k.parsed.value), ['оклад', 'оклада', 'окладов']);
      else if (k.size && !/^[-0]/.test(k.size)) sz = k.size;
      // размер не задан/не распознан — показываем хотя бы периодичность, без «· —»
      const parts = [k.type || 'премия'];
      if (sz) parts.push(sz);
      else if (k.per) parts.push(k.per);
      label = parts.join(' · ');
    } else {
      const word = kinds.length + ' ' + declRu(kinds.length, ['вид', 'вида', 'видов']);
      // Свёрнутую сумму «≈ N%» / «≈ N c» показываем ТОЛЬКО когда у всех видов
      // одна периодичность — иначе «15% в месяц + 10% в год» дало бы «≈ 25%».
      const samePer = kinds.every(k => k.per === kinds[0].per);
      const allPct = samePer && kinds.every(k => k.parsed.kind === 'pct');
      const allAbs = samePer && kinds.every(k => k.parsed.kind === 'abs');
      if (allPct) label = word + ' · ≈ ' + fmtNum(kinds.reduce((a, k) => a + k.parsed.value, 0)) + '%';
      else if (allAbs) label = word + ' · ≈ ' + fmtNum(kinds.reduce((a, k) => a + k.parsed.value, 0)) + ' c';
      else label = word;
    }
  }

  // Доминирующая периодичность. При равенстве счётчиков — стабильный порядок
  // (не зависит от порядка строк в выборке).
  const PER_RANK = { 'в месяц': 0, 'в квартал': 1, 'в полугодие': 2, 'в год': 3, 'разово': 4, 'в неделю': 5 };
  const perCnt = {};
  kinds.forEach(k => { if (k.per) perCnt[k.per] = (perCnt[k.per] || 0) + 1; });
  const topPer = Object.keys(perCnt).sort((a, b) =>
    (perCnt[b] - perCnt[a]) ||
    ((PER_RANK[a] == null ? 99 : PER_RANK[a]) - (PER_RANK[b] == null ? 99 : PER_RANK[b])) ||
    a.localeCompare(b, 'ru')
  )[0] || '';

  return {
    has,
    label,
    kinds: kinds.map(k => ({ type: k.type, size: k.size, per: k.per })),
    monthly: monthlyKnown ? Math.round(monthly) : null,
    topPer
  };
}

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

/**
 * Какой period_id показывать на дашборде. Фронт присылает filters.period —
 * пустая строка/undefined значит «текущий год» (по умолчанию), иначе это
 * id конкретного архивного года, выбранного в переключателе.
 */
function resolveDashboardPeriodId(rawFilterValue, currentPeriodId) {
  const n = parseInt(rawFilterValue, 10);
  if (Number.isFinite(n) && n > 0) return n;
  return currentPeriodId || null;
}

async function getExtendedAnalytics(filters = {}, opts = {}) {
  const filterDir = (filters.dir || '').trim();
  const filterHrbp = (filters.hrbp || '').trim();
  const filterRegion = (filters.region || '').trim();
  const searchPos = (filters.search || '').trim().toLowerCase();

  // Ограничение видимости по роли: для не-admin/cb дашборд и весь его расчёт
  // (вилки, медиана рынка, реестр) считаются только по доступным пользователю
  // подразделениям. Предикат по строке divisions приходит из контроллера.
  const unitFilter = typeof opts.unitFilter === 'function' ? opts.unitFilter : null;

  // Годовой архив: без явного filters.period дашборд показывает последний
  // (текущий) период — periodsList уходит на фронт для выпадающего списка.
  const periodsList = await queryAll('SELECT id, name FROM periods ORDER BY id DESC');
  const currentPeriodId = periodsList.length ? periodsList[0].id : null;
  const viewingPeriodId = resolveDashboardPeriodId(filters.period, currentPeriodId);

  // Параллельный запуск всех запросов к БД в 1 сетевом раунде
  const [divisionsRaw, competitors, surveys, posDict] = await Promise.all([
    // region добавлена миграцией; на не мигрированной базе колонки может не быть.
    queryAll("SELECT num, dir, unit, head, resp, hrbp, COALESCE(region,'') AS region FROM divisions")
      .catch(() => queryAll('SELECT num, dir, unit, head, resp, hrbp FROM divisions')
        .then(rows => rows.map(r => ({ ...r, region: '' })))),
    queryAll('SELECT unit, actual FROM competitors'),
    viewingPeriodId
      ? queryAll("SELECT * FROM surveys WHERE state != 'удалена' AND period_id = ?", [viewingPeriodId])
      : queryAll("SELECT * FROM surveys WHERE state != 'удалена'"),
    queryAll('SELECT name, COALESCE(pay_from,0) AS pay_from, COALESCE(pay_to,0) AS pay_to FROM dictionary_positions')
      .catch(() => [])
  ]);

  // Оклад Фаровона по должности (эталон для колонок «Мы» / «Гэп к рынку»)
  const ourPayByPos = {};
  posDict.forEach(p => {
    const from = Number(p.pay_from) || 0;
    const to = Number(p.pay_to) || 0;
    if (from > 0 || to > 0) {
      ourPayByPos[(p.name || '').trim().toLowerCase()] = {
        from,
        to,
        mid: (from > 0 && to > 0) ? Math.round((from + to) / 2) : (from || to)
      };
    }
  });

  // Отфильтрованная оргструктура — вся математика ниже идёт только по этим
  // подразделениям. allowedUnits === null означает «без ограничения» (admin/cb).
  const divisions = unitFilter ? divisionsRaw.filter(unitFilter) : divisionsRaw;
  const allowedUnits = unitFilter ? new Set(divisions.map(d => d.unit)) : null;

  // 1. Оргструктура
  const unitMap = {};
  divisions.forEach(d => {
    unitMap[d.unit] = {
      dir: d.dir || '',
      head: d.head || '',
      resp: d.resp || '',
      hrbp: d.hrbp || '',
      region: (d.region || '').trim(),
      totalComp: 0,
      doneComp: 0,
      askComp: 0,
      surveysCount: 0
    };
  });

  // 2. Конкуренты
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

  let totalRecords = 0;
  let recordsWithSalary = 0;
  const posMap = {};
  const rawRows = []; // сырые наблюдения для вкладки «Реестр данных»
  const allSalarySamples = []; // для общей медианы рынка (вкладка «Обзор»)
  const regionSamples = {};    // регион → {froms,tos,mids} для вкладки «По регионам»
  const benefitStats = {};
  const bonusStats = { hasBonus: 0, noBonus: 0, unknown: 0, types: {}, periods: {} };
  const compRank = {};
  const curStats = {};

  surveys.forEach(s => {
    const un = s.unit || '';
    if (allowedUnits && !allowedUnits.has(un)) return;
    const uInfo = unitMap[un] || { dir: '', hrbp: '', resp: '', region: '' };

    if (filterDir && uInfo.dir !== filterDir) return;
    if (filterHrbp && uInfo.hrbp !== filterHrbp) return;

    // Пер-регион вилки для вкладки «По регионам» — собираем ДО фильтра по
    // региону, чтобы в таблице были все регионы сразу (в пределах выбранных
    // направления / HR BP / видимости пользователя).
    {
      const rg = (uInfo.region || '').trim();
      if (rg) {
        const _pf = Number(s.pay_from) || 0;
        const _pt = Number(s.pay_to) || 0;
        const _hr = looksHourly((s.pay_per || '').trim(), _pf, _pt);
        const _pfm = toMonthly(_pf, _hr);
        const _ptm = toMonthly(_pt, _hr);
        const _m = (_pfm > 0 && _ptm > 0) ? (_pfm + _ptm) / 2 : (_pfm || _ptm || 0);
        if (_m > 0) {
          const b = regionSamples[rg] || (regionSamples[rg] = { froms: [], tos: [], mids: [] });
          if (_pfm > 0) b.froms.push(_pfm);
          if (_ptm > 0) b.tos.push(_ptm);
          b.mids.push(_m);
        }
      }
    }

    if (filterRegion && (uInfo.region || '') !== filterRegion) return;

    const posOur = (s.pos_our || '').trim();
    const company = (s.company || '').trim();
    const pFrom = Number(s.pay_from) || 0;
    const pTo = Number(s.pay_to) || 0;
    const cur = (s.cur || 'сомони').trim();
    const payPer = (s.pay_per || 'в месяц').trim();
    // ЧТС приводим к месяцу (× 168 ч) — для вилок, медианы и гистограммы.
    // Сырые pFrom/pTo остаются как есть для вкладки «Реестр данных».
    const isHourly = looksHourly(payPer, pFrom, pTo);
    const pFromM = toMonthly(pFrom, isHourly);
    const pToM = toMonthly(pTo, isHourly);
    const bonHas = (s.bon_has || '').trim().toLowerCase();
    const bonSize = (s.bon_size || '').trim();
    const bonType = (s.bon_type || '').trim();
    const bonPer = (s.bon_per || '').trim();
    // Переменная часть: все виды премии (surveys.bonuses), не только первый.
    const bonusArr = parseBonusesCol(s.bonuses, bonType, bonSize, bonPer);
    const rowMid = (pFromM > 0 && pToM > 0) ? (pFromM + pToM) / 2 : (pFromM || pToM || 0);
    const rowVarPay = summarizeVarPay(bonusArr, bonHas, rowMid);
    const benefits = s.benefits ? s.benefits.split(';').map(b => b.trim()).filter(Boolean) : [];
    const note = (s.note || '').trim();

    if (searchPos && !posOur.toLowerCase().includes(searchPos) && !company.toLowerCase().includes(searchPos)) {
      return;
    }

    totalRecords++;
    if (unitMap[un]) unitMap[un].surveysCount++;
    if (company) compRank[company] = (compRank[company] || 0) + 1;
    curStats[cur] = (curStats[cur] || 0) + 1;

    // Общая медиана рынка: ЧТС приведена к месяцу (pFromM/pToM). Дневных ставок
    // в данных фактически нет (одна строка «в день» с суммой 5000–10000 —
    // очевидно месячный оклад с ошибкой периода), поэтому берём как есть.
    {
      const mid = (pFromM > 0 && pToM > 0) ? (pFromM + pToM) / 2 : (pFromM || pToM || 0);
      if (mid > 0) allSalarySamples.push(mid);
    }

    // Регион: приоритет — структурный регион подразделения (divisions.region);
    // если не задан, падаем на разбор примечания импортированных строк
    // («Собрал: …; Регион: Худжанд; ID_Бизнес: 11»). Для ручных анкет без
    // региона подразделения — пусто.
    const regionMatch = note.match(/Регион:\s*([^;·]+)/i);
    const idbizMatch = note.match(/ID_Бизнес[^:]*:\s*([0-9 ,]+)/i);
    rawRows.push({
      date: s.created_at || '',
      dir: uInfo.dir || '',
      unit: un,
      company,
      region: (uInfo.region || '') || (regionMatch ? regionMatch[1].trim() : ''),
      idbiz: idbizMatch ? idbizMatch[1].trim() : '',
      posOur,
      posTheir: (s.pos_their || '').trim(),
      payFrom: pFrom,
      payTo: pTo,
      cur,
      payPer,
      bonHas,
      bonSize,
      bonType,
      bonPer,
      bonuses: bonusArr,   // все виды переменной части
      varPay: rowVarPay,   // свёртка для колонки «Переменная часть»
      benefits, // массив
      schedule: (s.schedule || '').trim(),
      by: (s.created_by || '').trim(),
      source: (s.source || '').trim(),
      note
    });

    // Бонусы: наличие считаем ТАК ЖЕ, как rowVarPay.has (и как bonCompanies по
    // должности) — иначе строка «премии: X из N» и карточка «Наличие премий»
    // дают разные цифры на одних данных. Виды/периодичность — по КАЖДОМУ виду.
    if (rowVarPay.has) {
      bonusStats.hasBonus++;
      const kindsForStats = bonusArr.length ? bonusArr : [{ type: bonType, per: bonPer }];
      kindsForStats.forEach(k => {
        const kt = String(k.type || '').trim();
        const kp = normPeriod(k.per);
        if (kt) bonusStats.types[kt] = (bonusStats.types[kt] || 0) + 1;
        if (kp) bonusStats.periods[kp] = (bonusStats.periods[kp] || 0) + 1;
      });
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
      if (pFromM > 0 || pToM > 0) {
        recordsWithSalary++;
        if (pFromM > 0) posMap[posOur].fromSamples.push(pFromM);
        if (pToM > 0) posMap[posOur].toSamples.push(pToM);
        avgPay = (pFromM > 0 && pToM > 0) ? Math.round((pFromM + pToM) / 2) : (pFromM || pToM);
        posMap[posOur].salarySamples.push(avgPay);
      }

      posMap[posOur].companies.push({
        company,
        unit: un,
        dir: uInfo.dir,
        pFrom: pFromM,
        pTo: pToM,
        avg: avgPay,
        hourly: isHourly,
        hourFrom: isHourly ? pFrom : 0,
        hourTo: isHourly ? pTo : 0,
        cur,
        payPer,
        bonHas,
        bonSize,
        bonType,
        bonPer,
        bonuses: bonusArr,
        varPay: rowVarPay,
        benefits,
        note
      });
    }
  });

  // Расчет перцентилей по должностям
  const positionsList = Object.keys(posMap).map(k => {
    const item = posMap[k];
    const stats = calculateSalaryForkStats(item.fromSamples, item.toSamples, item.salarySamples);
    const our = ourPayByPos[k.trim().toLowerCase()] || null;
    const gapPct = (our && our.mid > 0 && stats.median > 0)
      ? Math.round(((our.mid - stats.median) / stats.median) * 100)
      : null;

    // Переменная часть по должности: у скольких компаний есть премия, какая
    // периодичность типична, медиана совокупного дохода (оклад + премия/мес.).
    // Методология та же, что у benchmarkService.compare: в выборку входит
    // КАЖДАЯ компания с окладом; где премию посчитать нельзя — берётся только
    // оклад. Так число сравнимо с бенчмарком и не бывает «медианой одной
    // компании». totalMedian показывается фронтом только при ≥3 компаниях.
    const bonCompanies = item.companies.filter(c => c.varPay && c.varPay.has).length;
    const bonQuantified = item.companies.filter(c => c.varPay && c.varPay.monthly != null).length;
    const totalSamples = item.companies.map(c => {
      const base = c.avg || 0;
      if (!(base > 0)) return null;
      const bm = (c.varPay && c.varPay.monthly != null) ? c.varPay.monthly : 0;
      return base + bm;
    }).filter(v => v != null);
    const perTally = {};
    item.companies.forEach(c => {
      const p = c.varPay && c.varPay.topPer;
      if (p) perTally[p] = (perTally[p] || 0) + 1;
    });
    const bonTopPer = Object.keys(perTally).sort((a, b) => perTally[b] - perTally[a])[0] || '';

    return {
      pos: k,
      count: item.count,
      withSalaryCount: item.salarySamples.length,
      bonCompanies,
      bonQuantified,
      totalSampleCount: totalSamples.length,
      bonTopPer,
      totalMedian: totalSamples.length >= 3
        ? calculateSalaryForkStats([], [], totalSamples).median
        : 0,
      min: stats.min,
      p25: stats.p25,
      median: stats.median,
      p75: stats.p75,
      max: stats.max,
      avg: stats.avg,
      forkSpreadPct: stats.spread,
      ourFrom: our ? our.from : 0,
      ourTo: our ? our.to : 0,
      ourMid: our ? our.mid : 0,
      gapPct: gapPct,
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

  // Список регионов для фильтра дашборда — из оргструктуры (не из наблюдений),
  // чтобы набор опций был стабильным и уже суженным по видимости пользователя.
  const regions = [...new Set(
    Object.keys(unitMap).map(k => (unitMap[k].region || '').trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'ru'));

  // Вилки по регионам — вкладка «По регионам». Мин/P25/Медиана/P75/Макс/Средн.
  // по всем наблюдениям региона (месячный эквивалент, ЧТС приведена).
  const regionStats = Object.keys(regionSamples).map(rg => {
    const b = regionSamples[rg];
    const st = calculateSalaryForkStats(b.froms, b.tos, b.mids);
    return { region: rg, count: b.mids.length, min: st.min, p25: st.p25, median: st.median, p75: st.p75, max: st.max, avg: st.avg };
  }).sort((a, b) => b.median - a.median);

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
      positionsCount: positionsList.length,
      companiesInSurvey: Object.keys(compRank).length,
      unmappedRecords: (posMap['(не сопоставлено)'] && posMap['(не сопоставлено)'].count) || 0,
      // Медиана/перцентили рынка — тем же методом (интерполяция), что и вилки
      // по должностям, чтобы «Обзор» и таблица вилок не расходились на 1 слот.
      ...(() => {
        const st = calculateSalaryForkStats([], [], allSalarySamples);
        return { salaryMedian: st.median, salaryP25: st.p25, salaryP75: st.p75 };
      })()
    },
    hrbpProgress,
    dirProgress,
    regions,
    regionStats,
    positions: positionsList,
    rows: rawRows,
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
    },
    periodsList: periodsList.map(p => ({ id: p.id, name: p.name })),
    viewingPeriodId
  };
}

module.exports = {
  calculateSalaryForkStats,
  calculatePercentiles: calculateSalaryForkStats,
  getExtendedAnalytics,
  // экспортируются для юнит-проверок свёртки переменной части
  parseBonusesCol,
  parseBonusSize,
  perToMonthlyFactor,
  normPeriod,
  summarizeVarPay,
  resolveDashboardPeriodId,
};
