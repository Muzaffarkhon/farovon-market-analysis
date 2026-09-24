'use strict';

const { getRegistry, getRegistryCsv } = require('../services/registryService');
const { unitScopeFilterAsync } = require('../services/scopeService');
const { run } = require('../db/database');

/** Фильтры приходят телом POST; из query поддержаны для удобства отладки. */
function filtersOf(req) {
  const src = (req.body && Object.keys(req.body).length) ? req.body : (req.query || {});
  return { ...src };
}

exports.list = async (req, res) => {
  try {
    const result = await getRegistry(filtersOf(req), { unitFilter: await unitScopeFilterAsync(req.user) });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('registry error:', err.message);
    res.status(500).json({ ok: false, error: 'Внутренняя ошибка сервера' });
  }
};

/**
 * Выгрузка реестра. В отличие от дашборда, файл собирает сервер — значит и
 * запись в журнал делается здесь же, а не доверяется фронту.
 */
exports.exportCsv = async (req, res) => {
  try {
    const filters = filtersOf(req);
    const { csv, count } = await getRegistryCsv(filters, { unitFilter: await unitScopeFilterAsync(req.user) });

    try {
      let dump = '';
      try { dump = JSON.stringify(filters).slice(0, 300); } catch (e) { dump = ''; }
      await run('INSERT INTO audit_log (login, action, detail, ip) VALUES (?, ?, ?, ?)', [
        (req.user && req.user.login) || '?',
        'экспорт данных',
        `формат=csv; раздел=registry; строк=${count}` + (dump ? `; фильтры=${dump}` : '') +
          `; UA=${String(req.get('user-agent') || '').slice(0, 120)}`,
        req.ip || ''
      ]);
    } catch (e) {
      // Журнал не должен мешать человеку получить файл.
      console.error('registry export log error:', e.message);
    }

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="registry-${stamp}.csv"`);
    // BOM — иначе Excel на Windows читает кириллицу как кракозябры.
    res.send('﻿' + csv);
  } catch (err) {
    console.error('registry export error:', err.message);
    res.status(500).json({ ok: false, error: 'Внутренняя ошибка сервера' });
  }
};
