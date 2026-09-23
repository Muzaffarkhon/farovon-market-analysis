'use strict';

const { getCoordination } = require('../services/coordinationService');
const { sendCoordinationReminder } = require('../services/telegramService');
const { unitScopeFilter } = require('../services/scopeService');

exports.getCoordination = async (req, res) => {
  try {
    const filters = req.query || {};
    const result = await getCoordination(filters, { unitFilter: unitScopeFilter(req.user) });
    res.json(result);
  } catch (err) {
    console.error('coordination error:', err.message);
    res.status(500).json({ ok: false, error: 'Внутренняя ошибка сервера' });
  }
};

exports.remind = async (req, res) => {
  try {
    const logins = Array.isArray(req.body && req.body.logins) ? req.body.logins.map(String) : [];
    if (!logins.length) return res.status(400).json({ ok: false, error: 'Не выбраны получатели' });

    const result = await sendCoordinationReminder(logins, {
      unitFilter: unitScopeFilter(req.user),
      senderFio: (req.user && req.user.fio) || 'HR BP'
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('coordination remind error:', err.message);
    res.status(500).json({ ok: false, error: 'Внутренняя ошибка сервера' });
  }
};
