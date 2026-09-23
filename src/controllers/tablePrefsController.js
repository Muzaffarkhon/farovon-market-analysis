'use strict';

const { getTablePrefs, saveTablePrefs } = require('../services/tablePrefsService');

exports.get = async (req, res) => {
  try {
    const columns = await getTablePrefs(req.user.login, String(req.params.tableKey || ''));
    res.json({ ok: true, columns });
  } catch (err) {
    console.error('tablePrefs get error:', err.message);
    res.status(500).json({ ok: false, error: 'Внутренняя ошибка сервера' });
  }
};

exports.save = async (req, res) => {
  try {
    const columns = await saveTablePrefs(req.user.login, String(req.params.tableKey || ''), req.body && req.body.columns);
    res.json({ ok: true, columns });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Не удалось сохранить настройки таблицы' });
  }
};
