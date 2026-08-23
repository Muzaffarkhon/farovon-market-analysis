const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { getDb } = require('../db/database');

function hashPassword(pwd) {
  return bcrypt.hashSync(String(pwd || ''), 10);
}

function verifyPassword(pwd, user) {
  if (!user) return false;
  if (user.password_hash) {
    if (user.password_hash.startsWith('$2a$') || user.password_hash.startsWith('$2b$') || user.password_hash.startsWith('$2y$')) {
      try {
        if (bcrypt.compareSync(pwd, user.password_hash)) return true;
      } catch (e) {}
    }
    const sha = crypto.createHash('sha256').update(String(pwd || '')).digest('hex');
    if (user.password_hash === sha) return true;
  }
  if (user.raw_password && user.raw_password === pwd) return true;
  return false;
}

function makeToken(user) {
  return jwt.sign(
    { id: user.id, login: user.login, role: user.role, fio: user.fio },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

function getPeriodInfo(db) {
  const p = db.prepare('SELECT * FROM periods ORDER BY id DESC LIMIT 1').get();
  return p ? {
    name: p.name,
    state: p.state,
    from: p.from_date || '',
    to: p.to_date || '',
    by: p.updated_by || '',
    at: p.updated_at || ''
  } : { name: 'Обзор рынка', state: 'открыт' };
}

function getUserPayload(user, db) {
  const unitsList = user.units ? user.units.split(';').map(s => s.trim()).filter(Boolean) : [];
  const allUnits = db.prepare('SELECT unit, dir FROM divisions ORDER BY num ASC, unit ASC').all();

  // Подсчёт прогресса по доступным подразделениям
  const compRows = db.prepare('SELECT unit, actual FROM competitors').all();
  const survRows = db.prepare('SELECT unit FROM surveys WHERE state != "удалена"').all();

  const compMap = {};
  compRows.forEach(c => {
    if (!compMap[c.unit]) compMap[c.unit] = { total: 0, done: 0, ask: 0 };
    compMap[c.unit].total++;
    const act = (c.actual || '').toLowerCase();
    if (act === 'актуально' || act === 'не актуально') compMap[c.unit].done++;
    else if (act === 'уточнить') compMap[c.unit].ask++;
  });

  const survMap = {};
  survRows.forEach(s => {
    survMap[s.unit] = (survMap[s.unit] || 0) + 1;
  });

  // Получаем список назначенных подразделений
  let visibleUnits = [];
  if (user.role === 'admin' || user.role === 'cb') {
    visibleUnits = allUnits.map(d => ({
      unit: d.unit,
      dir: d.dir,
      total: (compMap[d.unit] || {}).total || 0,
      done: (compMap[d.unit] || {}).done || 0,
      ask: (compMap[d.unit] || {}).ask || 0,
      surveys: survMap[d.unit] || 0
    }));
  } else {
    visibleUnits = allUnits.filter(d => unitsList.includes(d.unit)).map(d => ({
      unit: d.unit,
      dir: d.dir,
      total: (compMap[d.unit] || {}).total || 0,
      done: (compMap[d.unit] || {}).done || 0,
      ask: (compMap[d.unit] || {}).ask || 0,
      surveys: survMap[d.unit] || 0
    }));
  }

  // Справочники
  const dictCompanies = db.prepare('SELECT name, segment, region FROM dictionary_companies ORDER BY name ASC').all();
  const dictPositions = db.prepare('SELECT name FROM dictionary_positions ORDER BY name ASC').all().map(x => x.name);

  // Конкуренты для пользователя
  const userUnitNames = visibleUnits.map(x => x.unit);
  let userCompetitors = [];
  let userSurveys = [];

  if (userUnitNames.length > 0) {
    const placeholders = userUnitNames.map(() => '?').join(',');
    userCompetitors = db.prepare(`SELECT * FROM competitors WHERE unit IN (${placeholders})`).all(...userUnitNames);
    userSurveys = db.prepare(`SELECT * FROM surveys WHERE unit IN (${placeholders}) AND state != "удалена"`).all(...userUnitNames);
  }

  return {
    user: {
      login: user.login,
      fio: user.fio,
      role: user.role,
      phone: user.phone || ''
    },
    period: getPeriodInfo(db),
    needsUnitPick: unitsList.length === 0 && user.role !== 'admin' && user.role !== 'cb',
    units: visibleUnits,
    allUnits: allUnits,
    rows: userCompetitors.map(c => ({
      id: c.cid,
      unit: c.unit,
      company: c.company,
      type: c.type || '',
      segment: c.segment || '',
      region: c.region || '',
      prio: c.prio || '',
      status: c.status || '',
      note: c.note || '',
      actual: c.actual || 'уточнить',
      by: c.updated_by || '',
      at: c.updated_at || ''
    })),
    surveys: userSurveys.map(s => ({
      id: s.sid,
      unit: s.unit,
      company: s.company,
      posOur: s.pos_our,
      posTheir: s.pos_their || '',
      grade: s.grade || '',
      payFrom: s.pay_from || '',
      payTo: s.pay_to || '',
      cur: s.cur || 'сомони',
      payPer: s.pay_per || 'в месяц',
      bonHas: s.bon_has || 'не знаю',
      bonSize: s.bon_size || '',
      bonType: s.bon_type || '',
      bonPer: s.bon_per || '',
      benefits: s.benefits || '',
      note: s.note || '',
      source: s.source || '',
      trust: s.trust || ''
    })),
    companies: dictCompanies.map(c => c.name),
    companiesAll: dictCompanies,
    positions: dictPositions,
    segments: ['Телеком', 'Банки и Финтех', 'Ритейл и FMCG', 'Производство и Дистрибуция', 'Строительство и Девелопмент', 'Услуги и Сервис', 'IT и Технологии'],
    regions: ['Душанбе', 'Худжанд', 'Бохтар', 'Куляб', 'РРП', 'ГБАО', 'Вся страна', 'Узбекистан', 'Казахстан', 'РФ']
  };
}

exports.login = (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) {
    return res.status(400).json({ ok: false, error: 'Введите логин и пароль' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE LOWER(login) = LOWER(?)').get(login.trim());

  if (!user) {
    return res.status(401).json({ ok: false, error: 'Неверный логин или пароль' });
  }

  if (!user.active) {
    return res.status(403).json({ ok: false, error: 'Учетная запись заблокирована' });
  }

  if (!verifyPassword(password, user)) {
    return res.status(401).json({ ok: false, error: 'Неверный логин или пароль' });
  }

  // Обновляем время входа
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, user.id);
  db.prepare('INSERT INTO audit_log (login, action, detail, ip) VALUES (?, ?, ?, ?)').run(
    user.login,
    'вход',
    'Успешная авторизация',
    req.ip
  );

  const token = makeToken(user);
  const data = getUserPayload(user, db);

  res.json({
    ok: true,
    token,
    data
  });
};

exports.resume = (req, res) => {
  const db = getDb();
  const data = getUserPayload(req.user, db);
  res.json({
    ok: true,
    token: makeToken(req.user),
    data
  });
};

exports.changePassword = (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ ok: false, error: 'Новый пароль должен содержать минимум 6 символов' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  if (!verifyPassword(oldPassword, user)) {
    return res.status(400).json({ ok: false, error: 'Неверный текущий пароль' });
  }

  const newHash = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, raw_password = NULL, updated_at = ? WHERE id = ?').run(
    newHash,
    new Date().toISOString(),
    user.id
  );
  db.prepare('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)').run(user.login, 'смена пароля', 'Пользователь изменил свой пароль');

  res.json({ ok: true, message: 'Пароль успешно изменён' });
};

exports.setUnits = (req, res) => {
  const { units } = req.body;
  if (!Array.isArray(units) || !units.length) {
    return res.status(400).json({ ok: false, error: 'Выберите хотя бы одно подразделение' });
  }

  const db = getDb();
  const unitsStr = units.join('; ');
  db.prepare('UPDATE users SET units = ? WHERE id = ?').run(unitsStr, req.user.id);

  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const data = getUserPayload(updatedUser, db);

  res.json({ ok: true, data });
};
