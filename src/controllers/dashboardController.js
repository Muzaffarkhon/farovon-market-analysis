const { getExtendedAnalytics } = require('../services/analyticsService');
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
 * Область видимости дашборда. admin/cb видят весь рынок (null — без
 * ограничения). Остальные роли — только доступные им подразделения; логика
 * ролей та же, что в getHRBPDashboard: HR BP — подразделения, где он указан
 * HR BP (либо HR BP не задан вовсе); dir_head и прочие ограниченные роли —
 * закреплённые за ними подразделения/направления (users.units).
 *
 * Возвращает предикат по строке divisions {unit, dir, hrbp, …} либо null.
 */
function dashboardUnitFilter(user) {
  if (!user || user.role === 'admin' || user.role === 'cb') return null;
  const units = Array.isArray(user.units) ? user.units : [];
  const fio = String(user.fio || '').toLowerCase();
  return (d) => {
    if (user.role === 'hrbp') {
      return d.hrbp ? String(d.hrbp).toLowerCase() === fio : true;
    }
    return units.includes(d.unit) || (!!d.dir && units.includes(d.dir));
  };
}

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

exports.getHRBPDashboard = async (req, res) => {
  try {
    const periodRaw = await queryOne('SELECT * FROM periods ORDER BY id DESC LIMIT 1');
    const [divisions, competitors, surveys] = await Promise.all([
      queryAll('SELECT num, dir, unit, head, resp, hrbp FROM divisions'),
      queryAll('SELECT unit, actual, updated_at FROM competitors'),
      queryAll("SELECT unit, created_at FROM surveys WHERE state != 'удалена' AND period_id = ?", [periodRaw ? periodRaw.id : null]),
    ]);

    const compMap = {};
    const lastMap = {};
    competitors.forEach(c => {
      if (!compMap[c.unit]) compMap[c.unit] = { total: 0, done: 0, ask: 0 };
      compMap[c.unit].total++;
      const act = (c.actual || '').toLowerCase();
      if (act === 'актуально' || act === 'не актуально') compMap[c.unit].done++;
      else if (act === 'уточнить') compMap[c.unit].ask++;
      if (c.updated_at && (!lastMap[c.unit] || c.updated_at > lastMap[c.unit])) lastMap[c.unit] = c.updated_at;
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
      out.push({
        unit: d.unit,
        dir: d.dir || '',
        hrbp: d.hrbp || '',
        resp: d.resp || d.head || '',
        total: c.total,
        done: c.done,
        ask: c.ask,
        surveys: survMap[d.unit] || 0,
        state: (c.total > 0 && c.done === c.total) ? 'заполнено' : (c.done > 0 ? 'в процессе' : 'не начато'),
        at: lastMap[d.unit] || ''
      });
    });

    out.sort((a, b) => (a.done / (a.total || 1)) - (b.done / (b.total || 1)));

    const period = periodRaw || { name: 'Обзор рынка', state: 'открыт' };

    res.json({
      ok: true,
      rows: out,
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
