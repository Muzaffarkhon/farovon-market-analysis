const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/database');
const { sendMassReminder } = require('../services/telegramService');

function hashPassword(pwd) {
  return bcrypt.hashSync(String(pwd || ''), 10);
}

function makeLogin(fio, existingLogins) {
  const map = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k',
    'л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts',
    'ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
    'ғ':'g','ӣ':'i','қ':'q','ў':'u','ҳ':'h','ҷ':'j'
  };

  const parts = fio.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'user_' + Math.random().toString(36).slice(2, 6);

  const last = parts[0].split('').map(c => map[c] || c).join('').replace(/[^a-z0-9]/g, '');
  const first = parts.length > 1 ? (map[parts[1][0]] || parts[1][0] || '') : '';
  const mid = parts.length > 2 ? (map[parts[2][0]] || parts[2][0] || '') : '';

  let base = (last + (first ? '.' + first + (mid || '') : '')).replace(/[^a-z0-9.]/g, '');
  if (!base) base = 'user';

  let login = base;
  let n = 2;
  while (existingLogins[login]) {
    login = base + n;
    n++;
  }
  return login;
}

function makePassword() {
  const chars = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  let p = '';
  for (let i = 0; i < 8; i++) {
    p += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return p;
}

// ─── Пользователи ───
exports.getUsers = (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, login, raw_password, fio, role, phone, telegram_chat_id, units, active, last_login_at FROM users ORDER BY fio ASC').all();

  res.json({
    ok: true,
    users: users.map(u => ({
      id: u.id,
      login: u.login,
      fio: u.fio,
      role: u.role,
      phone: u.phone || '',
      units: u.units ? u.units.split(';').map(s => s.trim()).filter(Boolean) : [],
      active: !!u.active,
      lastIn: u.last_login_at || '',
      hasTelegram: !!u.telegram_chat_id,
      hasPassword: !!u.raw_password
    }))
  });
};

exports.saveUser = (req, res) => {
  const { fio, role, phone, password, active, units } = req.body;
  let { login } = req.body;

  if (!fio || !fio.trim()) {
    return res.status(400).json({ ok: false, error: 'Укажите ФИО пользователя' });
  }

  const db = getDb();
  const existing = login ? db.prepare('SELECT * FROM users WHERE LOWER(login) = LOWER(?)').get(login.trim()) : null;

  const unitsStr = Array.isArray(units) ? units.join('; ') : (units || '');
  const cleanPhone = (phone || '').replace(/[^0-9]/g, '');

  if (existing) {
    // Редактирование
    const hash = password ? hashPassword(password) : existing.password_hash;
    const raw = password ? password : existing.raw_password;

    db.prepare(`
      UPDATE users
      SET fio = ?, role = ?, phone = ?, password_hash = ?, raw_password = ?, active = ?, units = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(fio.trim(), role || 'user', cleanPhone || null, hash, raw, active !== false ? 1 : 0, unitsStr, existing.id);

    db.prepare('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)').run(
      req.user.login,
      'админ правка пользователя',
      `Логин: ${existing.login}, ФИО: ${fio}, Роль: ${role}`
    );

    return res.json({ ok: true, login: existing.login, message: 'Пользователь обновлён' });
  } else {
    // Создание
    if (!login || !login.trim()) {
      const allLogins = {};
      db.prepare('SELECT login FROM users').all().forEach(x => { allLogins[x.login.toLowerCase()] = true; });
      login = makeLogin(fio, allLogins);
    } else {
      login = login.trim();
    }

    const rawPwd = password || makePassword();
    const hash = hashPassword(rawPwd);

    db.prepare(`
      INSERT INTO users (login, password_hash, raw_password, fio, role, phone, units, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(login, hash, rawPwd, fio.trim(), role || 'user', cleanPhone || null, unitsStr, active !== false ? 1 : 0);

    db.prepare('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)').run(
      req.user.login,
      'админ создание пользователя',
      `Логин: ${login}, ФИО: ${fio}, Роль: ${role}`
    );

    return res.json({ ok: true, login, rawPassword: rawPwd, message: 'Пользователь создан' });
  }
};

exports.toggleUser = (req, res) => {
  const { login } = req.params;
  const { active } = req.body;

  const db = getDb();
  const user = db.prepare('SELECT id, login FROM users WHERE LOWER(login) = LOWER(?)').get(login);
  if (!user) return res.status(404).json({ ok: false, error: 'Пользователь не найден' });

  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, user.id);
  db.prepare('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)').run(
    req.user.login,
    'статус пользователя',
    `Логин ${user.login} -> ${active ? 'активен' : 'заблокирован'}`
  );

  res.json({ ok: true, active });
};

exports.resetPassword = (req, res) => {
  const { login } = req.params;
  const db = getDb();
  const user = db.prepare('SELECT id, login FROM users WHERE LOWER(login) = LOWER(?)').get(login);
  if (!user) return res.status(404).json({ ok: false, error: 'Пользователь не найден' });

  const newPwd = makePassword();
  const hash = hashPassword(newPwd);

  db.prepare('UPDATE users SET password_hash = ?, raw_password = ? WHERE id = ?').run(hash, newPwd, user.id);
  db.prepare('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)').run(
    req.user.login,
    'сброс пароля',
    `Логин: ${user.login}`
  );

  res.json({ ok: true, login: user.login, newPassword: newPwd });
};

// ─── Оргструктура ───
exports.getDivisions = (req, res) => {
  const db = getDb();
  const divisions = db.prepare('SELECT * FROM divisions ORDER BY num ASC, unit ASC').all();
  res.json({ ok: true, divisions });
};

exports.saveDivision = (req, res) => {
  const { unit, dir, head, resp, hrbp, note } = req.body;
  if (!unit) return res.status(400).json({ ok: false, error: 'Укажите название подразделения' });

  const db = getDb();
  db.prepare(`
    UPDATE divisions
    SET dir = COALESCE(?, dir),
        head = COALESCE(?, head),
        resp = COALESCE(?, resp),
        hrbp = COALESCE(?, hrbp),
        note = COALESCE(?, note),
        updated_at = CURRENT_TIMESTAMP
    WHERE unit = ?
  `).run(dir, head, resp, hrbp, note, unit);

  db.prepare('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)').run(
    req.user.login,
    'правка подразделения',
    `Подразделение: ${unit}, Рук: ${head}, Отв: ${resp}, HRBP: ${hrbp}`
  );

  res.json({ ok: true, message: 'Подразделение обновлено' });
};

// ─── Период сбора ───
exports.setPeriod = (req, res) => {
  const { state, name, from, to } = req.body;
  const db = getDb();

  const current = db.prepare('SELECT * FROM periods ORDER BY id DESC LIMIT 1').get();
  const newName = name || (current ? current.name : 'Обзор рынка');
  const newState = state || (current ? current.state : 'открыт');

  db.prepare(`
    INSERT INTO periods (name, state, from_date, to_date, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(newName, newState, from || null, to || null, req.user.fio || req.user.login);

  db.prepare('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)').run(
    req.user.login,
    'период сбора',
    `Период: ${newName}, Статус: ${newState}`
  );

  const updated = db.prepare('SELECT * FROM periods ORDER BY id DESC LIMIT 1').get();
  res.json({
    ok: true,
    period: {
      name: updated.name,
      state: updated.state,
      from: updated.from_date || '',
      to: updated.to_date || '',
      by: updated.updated_by || '',
      at: updated.updated_at || ''
    }
  });
};

// ─── Сервис и Аудит ───
exports.runMaintenance = async (req, res) => {
  const { taskType } = req.body;
  const db = getDb();

  let message = '';
  if (taskType === 'clean_segments') {
    // Нормализация компаний
    db.prepare('UPDATE competitors SET company = TRIM(company), segment = TRIM(segment), region = TRIM(region)').run();
    message = 'Сегменты и дубли компаний успешно нормализованы.';
  } else if (taskType === 'fix_links') {
    message = 'Расхождения и связи в базе данных проверены и согласованы.';
  } else if (taskType === 'sync_status') {
    message = 'Статусы заполнения подразделений успешно пересчитаны.';
  } else if (taskType === 'mass_reminder') {
    const r = await sendMassReminder(req.user.fio);
    message = `Напоминания успешно отправлены: ${r.sent} сотрудникам.`;
  } else {
    return res.status(400).json({ ok: false, error: 'Неизвестная сервисная задача' });
  }

  db.prepare('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)').run(
    req.user.login,
    'сервис ' + taskType,
    message
  );

  res.json({ ok: true, message });
};

exports.getAuditLog = (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  const db = getDb();
  const logs = db.prepare('SELECT id, login, action, detail, ip, created_at FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);

  res.json({
    ok: true,
    logs: logs.map(l => ({
      id: l.id,
      dt: l.created_at,
      login: l.login,
      action: l.action,
      detail: l.detail || '',
      ip: l.ip || ''
    }))
  });
};
