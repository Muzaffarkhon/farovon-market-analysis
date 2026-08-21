const { getExtendedAnalytics } = require('../services/analyticsService');
const { getDb } = require('../db/database');

exports.getCBDashboard = (req, res) => {
  try {
    const filters = req.body || req.query || {};
    const analytics = getExtendedAnalytics(filters);
    res.json(analytics);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

exports.getHRBPDashboard = (req, res) => {
  try {
    const db = getDb();
    const divisions = db.prepare('SELECT num, dir, unit, head, resp, hrbp FROM divisions').all();
    const competitors = db.prepare('SELECT unit, actual FROM competitors').all();
    const surveys = db.prepare('SELECT unit FROM surveys WHERE state != "удалена"').all();

    const compMap = {};
    competitors.forEach(c => {
      if (!compMap[c.unit]) compMap[c.unit] = { total: 0, done: 0, ask: 0 };
      compMap[c.unit].total++;
      const act = (c.actual || '').toLowerCase();
      if (act === 'актуально' || act === 'не актуально') compMap[c.unit].done++;
      else if (act === 'уточнить') compMap[c.unit].ask++;
    });

    const survMap = {};
    surveys.forEach(s => {
      survMap[s.unit] = (survMap[s.unit] || 0) + 1;
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
        at: ''
      });
    });

    out.sort((a, b) => (a.done / (a.total || 1)) - (b.done / (b.total || 1)));

    const period = db.prepare('SELECT * FROM periods ORDER BY id DESC LIMIT 1').get() || { name: 'Обзор рынка', state: 'открыт' };

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
    res.status(500).json({ ok: false, error: err.message });
  }
};

exports.exportCSV = (req, res) => {
  try {
    const analytics = getExtendedAnalytics(req.query || {});
    const positions = analytics.positions || [];

    const headers = ['Должность', 'Всего записей', 'С окладом', 'Мин (TJS)', '25% перцентиль (TJS)', 'Медиана (TJS)', '75% перцентиль (TJS)', 'Макс (TJS)', 'Среднее (TJS)', 'Размах вилки (%)'];
    const rows = positions.map(p => [
      '"' + (p.pos || '').replace(/"/g, '""') + '"',
      p.count,
      p.withSalaryCount,
      p.min,
      p.p25,
      p.median,
      p.p75,
      p.max,
      p.avg,
      p.forkSpreadPct + '%'
    ].join(';'));

    const csvContent = '\uFEFF' + headers.join(';') + '\n' + rows.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="salary_benchmarking_farovon.csv"');
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
