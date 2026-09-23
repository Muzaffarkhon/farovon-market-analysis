const { getExtendedAnalytics } = require('../services/analyticsService');
const { getActivePeriod } = require('../services/periodService');
const { isHiddenCompany } = require('../services/companyFilter');
const { unitScopeFilter } = require('../services/scopeService');
const { queryAll, queryOne, run } = require('../db/database');

/**
 * Журналирование выгрузок данных из системы. CSV на дашборде формируется в
 * браузере (сервер файла не видит), поэтому фронт перед скачиванием дёргает
 * этот эндпоинт: пишем кто / когда / откуда (IP) / что именно и в каком объёме.
 * Тело: { kind, rows, format, filters }.
 */
exports.logExport = async (req, res) => {
  try {
    const b = req.body || {};
    const kind = String(b.kind || 'dashboard').slice(0, 40);
    const format = String(b.format || 'csv').slice(0, 12);
    const rows = Number.isFinite(+b.rows) ? Math.max(0, Math.trunc(+b.rows)) : null;
    let filters = '';
    try {
      filters = b.filters ? JSON.stringify(b.filters).slice(0, 300) : '';
    } catch (e) { filters = ''; }

    const detail = `формат=${format}; раздел=${kind}` +
      (rows != null ? `; строк=${rows}` : '') +
      (filters ? `; фильтры=${filters}` : '') +
      `; UA=${String(req.get('user-agent') || '').slice(0, 120)}`;

    await run('INSERT INTO audit_log (login, action, detail, ip) VALUES (?, ?, ?, ?)', [
      (req.user && req.user.login) || '?',
      'экспорт данных',
      detail,
      req.ip || ''
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error('logExport error:', err.message);
    // Не мешаем пользователю скачать файл, даже если журнал недоступен.
    res.json({ ok: false });
  }
};

/**
 * Область видимости дашборда — общий предикат для всех разделов рынка,
 * см. services/scopeService. Имя сохранено, чтобы не трогать вызовы ниже.
 */
const dashboardUnitFilter = unitScopeFilter;

exports.getCBDashboard = async (req, res) => {
  try {
    const filters = req.body || req.query || {};
    const unitFilter = dashboardUnitFilter(req.user);
    const analytics = await getExtendedAnalytics(filters, { unitFilter });
    if (analytics && typeof analytics === 'object' && !Array.isArray(analytics)) {
      analytics.scoped = !!unitFilter; // фронт покажет пометку «только ваши подразделения»
    }
    res.json(analytics);
  } catch (err) {
    console.error('dashboard error:', err);
    res.status(500).json({ ok: false, error: 'Внутренняя ошибка сервера' });
  }
};

// Новый клиент (redesign/react, этап 3) ходит сюда за теми же данными — имя
// «CB» историческое, роль на выбор данных не влияет: единственное ограничение
// уже даёт unitFilter выше. Не путать с getHRBPDashboard ниже — это другой
// экран («Отчёт по подразделениям» / координация, этап 4), не альтернативная
// подача той же аналитики.
exports.getDashboard = exports.getCBDashboard;

exports.getHRBPDashboard = async (req, res) => {
  try {
    const periodRaw = await getActivePeriod();
    const [divisions, selectionsRaw, surveys, staffing] = await Promise.all([
      queryAll('SELECT num, dir, unit, head, resp, hrbp FROM divisions'),
      // Position-first Шаг 1: выбор компаний по должности (заменяет прежний
      // унитарный на весь unit флаг competitors.actual), period-scoped.
      queryAll('SELECT unit, pos_our, company, selected_at FROM position_company_selections WHERE period_id = ?', [periodRaw ? periodRaw.id : null]),
      queryAll("SELECT unit, pos_our, company, pay_from, pay_to, created_at FROM surveys WHERE state != 'удалена' AND period_id = ?", [periodRaw ? periodRaw.id : null]),
      queryAll('SELECT unit, position FROM unit_positions').catch(() => []),
    ]);
    // ООО / ҶДММ исключены из обзора рынка (см. services/companyFilter).
    const selections = selectionsRaw.filter(c => !isHiddenCompany(c.company));

    // Должности по подразделению: знаменатель — штатка (unit_positions),
    // числитель — сколько из этих должностей уже закрыто рынком (есть хотя бы
    // одна запись surveys за текущий период с таким pos_our).
    const normPos = (v) => String(v || '').trim().toLowerCase();
    const posMap = {};
    staffing.forEach(sp => {
      if (!posMap[sp.unit]) posMap[sp.unit] = { set: new Set(), filled: new Set() };
      posMap[sp.unit].set.add(normPos(sp.position));
    });
    surveys.forEach(s => {
      const p = normPos(s.pos_our);
      if (!p) return;
      const pm = posMap[s.unit];
      if (pm && pm.set.has(p)) pm.filled.add(p);
    });

    // «total/done» теперь считаются по парам «должность × компания», отмеченным
    // релевантными для сравнения (position_company_selections), а не по флагу
    // competitors.actual на всю компанию сразу. «ask» (унитарное «уточнить»)
    // концептуально исчез вместе со старым Шагом 1 — оставлен нулём в ответе,
    // чтобы не ломать форму данных для фронта.
    const filledKeys = new Set();
    surveys.forEach(s => {
      if (Number(s.pay_from) > 0 || Number(s.pay_to) > 0) {
        filledKeys.add(`${s.unit}|${normPos(s.pos_our)}|${normPos(s.company)}`);
      }
    });
    const compMap = {};
    const lastMap = {};
    selections.forEach(c => {
      if (!compMap[c.unit]) compMap[c.unit] = { total: 0, done: 0, ask: 0 };
      compMap[c.unit].total++;
      if (filledKeys.has(`${c.unit}|${normPos(c.pos_our)}|${normPos(c.company)}`)) compMap[c.unit].done++;
      if (c.selected_at && (!lastMap[c.unit] || c.selected_at > lastMap[c.unit])) lastMap[c.unit] = c.selected_at;
    });

    const survMap = {};
    surveys.forEach(s => {
      survMap[s.unit] = (survMap[s.unit] || 0) + 1;
      if (s.created_at && (!lastMap[s.unit] || s.created_at > lastMap[s.unit])) lastMap[s.unit] = s.created_at;
    });

    const isAll = (req.user.role === 'admin' || req.user.role === 'cb');
    const out = [];

    divisions.forEach(d => {
      if (!isAll) {
        if (req.user.role === 'hrbp' && d.hrbp && d.hrbp.toLowerCase() !== req.user.fio.toLowerCase()) return;
        if (req.user.role === 'dir_head' && !req.user.units.includes(d.unit) && (!d.dir || !req.user.units.includes(d.dir))) return;
      }

      const c = compMap[d.unit] || { total: 0, done: 0, ask: 0 };
      const pm = posMap[d.unit];
      out.push({
        unit: d.unit,
        dir: d.dir || '',
        hrbp: d.hrbp || '',
        resp: d.resp || d.head || '',
        total: c.total,
        done: c.done,
        ask: c.ask,
        surveys: survMap[d.unit] || 0,
        posTotal: pm ? pm.set.size : 0,
        posFilled: pm ? pm.filled.size : 0,
        state: (c.total > 0 && c.done === c.total) ? 'заполнено' : (c.done > 0 ? 'в процессе' : 'не начато'),
        at: lastMap[d.unit] || ''
      });
    });

    out.sort((a, b) => (a.done / (a.total || 1)) - (b.done / (b.total || 1)));

    // Уникальные компании в видимых пользователю подразделениях — построчная
    // сумма total/done по отделам многократно считает одну и ту же компанию
    // («Далерон» висит на 130 отделах). «проверено» — у компании есть хотя бы
    // одна пара «должность × компания» с уже внесёнными данными по рынку.
    // «На уточнении» — концепция унитарного Шага 1 (competitors.actual),
    // упразднена вместе с ним; marketAskCompanies оставлен нулём ради
    // обратной совместимости формы ответа.
    const visibleUnits = new Set(out.map(r => r.unit));
    const compByName = new Map();
    selections.forEach(c => {
      if (!visibleUnits.has(c.unit)) return;
      const name = String(c.company || '').trim().toLowerCase();
      if (!name) return;
      let e = compByName.get(name);
      if (!e) { e = { anyDone: false }; compByName.set(name, e); }
      if (filledKeys.has(`${c.unit}|${normPos(c.pos_our)}|${normPos(c.company)}`)) e.anyDone = true;
    });
    let marketCompaniesDone = 0;
    const marketAskCompanies = 0;
    compByName.forEach(e => {
      if (e.anyDone) marketCompaniesDone++;
    });
    const marketCompanies = compByName.size;

    const period = periodRaw || { name: 'Обзор рынка', state: 'открыт' };

    res.json({
      ok: true,
      rows: out,
      marketCompanies,
      marketCompaniesDone,
      marketAskCompanies,
      period: {
        name: period.name,
        state: period.state,
        from: period.from_date || '',
        to: period.to_date || '',
        by: period.updated_by || '',
        at: period.updated_at || ''
      }
    });
  } catch (err) {
    console.error('dashboard error:', err);
    res.status(500).json({ ok: false, error: 'Внутренняя ошибка сервера' });
  }
};

// Защита от CSV-инъекции: Excel/Sheets исполняют содержимое ячейки, если оно
// начинается с = + - @ или управляющего символа. Гасим ведущим апострофом.
function csvCell(value) {
  const s = String(value == null ? '' : value);
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return '"' + safe.replace(/"/g, '""') + '"';
}

exports.exportCSV = async (req, res) => {
  try {
    // Та же область видимости, что и у дашборда — не-admin/cb не выгрузит
    // рынок целиком через этот эндпоинт.
    const analytics = await getExtendedAnalytics(req.query || {}, { unitFilter: dashboardUnitFilter(req.user) });
    const positions = analytics.positions || [];

    const headers = ['Должность', 'Всего записей', 'С окладом', 'Мин (TJS)', '25% перцентиль (TJS)', 'Медиана (TJS)', '75% перцентиль (TJS)', 'Макс (TJS)', 'Среднее (TJS)', 'Размах вилки (%)', 'Компаний с премией', 'Типичная периодичность премии', 'Совокупно, медиана (TJS)'];
    const rows = positions.map(p => [
      csvCell(p.pos),
      p.count,
      p.withSalaryCount,
      p.min,
      p.p25,
      p.median,
      p.p75,
      p.max,
      p.avg,
      p.forkSpreadPct + '%',
      p.bonCompanies != null ? p.bonCompanies : '',
      csvCell(p.bonTopPer || ''),
      p.totalMedian || ''
    ].join(';'));

    const csvContent = '\uFEFF' + headers.join(';') + '\n' + rows.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="farovon_salary_analytics_${Date.now()}.csv"`);
    res.send(csvContent);
  } catch (err) {
    console.error('dashboard error:', err);
    res.status(500).json({ ok: false, error: 'Внутренняя ошибка сервера' });
  }
};
