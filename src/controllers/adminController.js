const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { queryAll, queryOne, run } = require('../db/database');
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
exports.getUsers = async (req, res) => {
  try {
    const users = await queryAll("SELECT id, login, fio, role, phone, telegram_chat_id, units, active, last_login_at FROM users WHERE archived_at IS NULL ORDER BY fio ASC");

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
        hasPassword: true
      }))
    });
  } catch (err) {
    console.error('getUsers error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка загрузки пользователей: ' + err.message });
  }
};

exports.saveUser = async (req, res) => {
  const { fio, role, phone, password, active, units } = req.body;
  let { login } = req.body;

  if (!fio || !fio.trim()) {
    return res.status(400).json({ ok: false, error: 'Укажите ФИО пользователя' });
  }

  try {
    const existing = login ? await queryOne('SELECT * FROM users WHERE LOWER(login) = LOWER(?)', [login.trim()]) : null;

    const unitsStr = Array.isArray(units) ? units.join('; ') : (units || '');
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');

    if (existing) {
      // Редактирование
      const hash = password ? hashPassword(password) : null;

      await run(`
        UPDATE users
        SET fio = ?, role = ?, phone = ?, password_hash = COALESCE(?, password_hash), active = ?, units = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [fio.trim(), role || 'user', cleanPhone || null, hash, active !== false ? 1 : 0, unitsStr, existing.id]);

      await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
        req.user.login,
        'админ правка пользователя',
        `Логин: ${existing.login}, ФИО: ${fio}, Роль: ${role}`
      ]);

      return res.json({ ok: true, login: existing.login, message: 'Пользователь обновлён' });
    } else {
      // Создание
      if (!login || !login.trim()) {
        const allUsers = await queryAll('SELECT login FROM users');
        const allLogins = {};
        allUsers.forEach(x => { allLogins[x.login.toLowerCase()] = true; });
        login = makeLogin(fio, allLogins);
      } else {
        login = login.trim();
      }

      const rawPwd = password || makePassword();
      const hash = hashPassword(rawPwd);

      await run(`
        INSERT INTO users (login, password_hash, fio, role, phone, units, active)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [login, hash, fio.trim(), role || 'user', cleanPhone || null, unitsStr, active !== false ? 1 : 0]);

      await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
        req.user.login,
        'админ создание пользователя',
        `Логин: ${login}, ФИО: ${fio}, Роль: ${role}`
      ]);

      return res.json({ ok: true, login, rawPassword: rawPwd, message: 'Пользователь создан' });
    }
  } catch (err) {
    console.error('saveUser error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка сохранения пользователя' });
  }
};

exports.toggleUser = async (req, res) => {
  const { login } = req.params;
  const { active } = req.body;

  try {
    const user = await queryOne('SELECT id, login FROM users WHERE LOWER(login) = LOWER(?)', [login]);
    if (!user) return res.status(404).json({ ok: false, error: 'Пользователь не найден' });

    await run('UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, user.id]);
    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'статус пользователя',
      `Логин ${user.login} -> ${active ? 'активен' : 'заблокирован'}`
    ]);

    res.json({ ok: true, active });
  } catch (err) {
    console.error('toggleUser error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка изменения статуса' });
  }
};

// ─── Архив пользователей ───
// Учётки гасим, а не удаляем: архивный пользователь пропадает из основного списка и не
// может войти, но данные (его заполненные анкеты, аудит-лог) никуда не деваются и его
// можно вернуть кнопкой «Восстановить».
exports.getArchivedUsers = async (req, res) => {
  try {
    const users = await queryAll("SELECT id, login, fio, role, phone, units, archived_at FROM users WHERE archived_at IS NOT NULL ORDER BY archived_at DESC");

    res.json({
      ok: true,
      users: users.map(u => ({
        id: u.id,
        login: u.login,
        fio: u.fio,
        role: u.role,
        phone: u.phone || '',
        units: u.units ? u.units.split(';').map(s => s.trim()).filter(Boolean) : [],
        archivedAt: u.archived_at
      }))
    });
  } catch (err) {
    console.error('getArchivedUsers error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка загрузки архива' });
  }
};

exports.archiveUser = async (req, res) => {
  const { login } = req.params;

  try {
    const user = await queryOne('SELECT id, login, role FROM users WHERE LOWER(login) = LOWER(?)', [login]);
    if (!user) return res.status(404).json({ ok: false, error: 'Пользователь не найден' });
    if (user.role === 'admin' && req.user.login.toLowerCase() === user.login.toLowerCase()) {
      return res.status(400).json({ ok: false, error: 'Нельзя архивировать самого себя' });
    }

    // active сбрасываем заодно:архивный не должен остаться залогиненным по старой сессии
    await run("UPDATE users SET archived_at = CURRENT_TIMESTAMP, active = 0 WHERE id = ?", [user.id]);
    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'архивирование пользователя',
      `Логин: ${user.login}`
    ]);

    res.json({ ok: true });
  } catch (err) {
    console.error('archiveUser error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка архивирования' });
  }
};

exports.restoreUser = async (req, res) => {
  const { login } = req.params;

  try {
    const user = await queryOne('SELECT id, login FROM users WHERE LOWER(login) = LOWER(?)', [login]);
    if (!user) return res.status(404).json({ ok: false, error: 'Пользователь не найден' });

    await run("UPDATE users SET archived_at = NULL WHERE id = ?", [user.id]);
    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'восстановление пользователя',
      `Логин: ${user.login}`
    ]);

    res.json({ ok: true });
  } catch (err) {
    console.error('restoreUser error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка восстановления' });
  }
};

exports.resetPassword = async (req, res) => {
  const { login } = req.params;

  try {
    const user = await queryOne('SELECT id, login FROM users WHERE LOWER(login) = LOWER(?)', [login]);
    if (!user) return res.status(404).json({ ok: false, error: 'Пользователь не найден' });

    const newPwd = makePassword();
    const hash = hashPassword(newPwd);

    await run('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [hash, user.id]);
    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'сброс пароля',
      `Логин: ${user.login}`
    ]);

    res.json({ ok: true, login: user.login, newPassword: newPwd });
  } catch (err) {
    console.error('resetPassword error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка сброса пароля' });
  }
};

// ─── Оргструктура ───
exports.getDivisions = async (req, res) => {
  try {
    const divisions = await queryAll('SELECT * FROM divisions ORDER BY num ASC, unit ASC');
    res.json({ ok: true, divisions });
  } catch (err) {
    console.error('getDivisions error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка загрузки подразделений' });
  }
};

exports.saveDivision = async (req, res) => {
  const { unit, dir, head, resp, hrbp, note } = req.body;
  if (!unit) return res.status(400).json({ ok: false, error: 'Укажите название подразделения' });

  try {
    await run(`
      UPDATE divisions
      SET dir = COALESCE(?, dir),
          head = COALESCE(?, head),
          resp = COALESCE(?, resp),
          hrbp = COALESCE(?, hrbp),
          note = COALESCE(?, note),
          updated_at = CURRENT_TIMESTAMP
      WHERE unit = ?
    `, [dir, head, resp, hrbp, note, unit]);

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'правка подразделения',
      `Подразделение: ${unit}, Рук: ${head}, Отв: ${resp}, HRBP: ${hrbp}`
    ]);

    res.json({ ok: true, message: 'Подразделение обновлено' });
  } catch (err) {
    console.error('saveDivision error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка сохранения подразделения' });
  }
};

// ─── Период сбора ───
exports.setPeriod = async (req, res) => {
  const { state, name, from, to } = req.body;

  try {
    const current = await queryOne('SELECT * FROM periods ORDER BY id DESC LIMIT 1');
    const newName = name || (current ? current.name : 'Обзор рынка');
    const newState = state || (current ? current.state : 'открыт');

    await run(`
      INSERT INTO periods (name, state, from_date, to_date, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [newName, newState, from || null, to || null, req.user.fio || req.user.login]);

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'период сбора',
      `Период: ${newName}, Статус: ${newState}`
    ]);

    const updated = await queryOne('SELECT * FROM periods ORDER BY id DESC LIMIT 1');
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
  } catch (err) {
    console.error('setPeriod error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка настройки периода' });
  }
};

// ─── Сервис и Аудит ───
exports.runMaintenance = async (req, res) => {
  const { taskType } = req.body;

  try {
    let message = '';
    if (taskType === 'clean_segments') {
      // Чистка пробелов + подтягивание сегмента/региона из справочника компаний
      // в строки, где они пустые. Раньше делался только TRIM, а сообщение
      // обещало ещё и нормализацию сегментов и дублей — теперь совпадает.
      await run('UPDATE competitors SET company = TRIM(company), segment = TRIM(COALESCE(segment, \'\')), region = TRIM(COALESCE(region, \'\'))');
      await run('UPDATE dictionary_companies SET name = TRIM(name), segment = TRIM(COALESCE(segment, \'\')), region = TRIM(COALESCE(region, \'\'))');
      const filled = await run(
        `UPDATE competitors SET
           segment = COALESCE((SELECT d.segment FROM dictionary_companies d WHERE d.name = competitors.company), segment),
           region  = COALESCE((SELECT d.region  FROM dictionary_companies d WHERE d.name = competitors.company), region)
         WHERE (TRIM(COALESCE(segment,'')) = '' OR TRIM(COALESCE(region,'')) = '')
           AND company IN (SELECT name FROM dictionary_companies)`
      );
      const added = await run(
        `INSERT OR IGNORE INTO dictionary_companies (name, segment, region)
         SELECT DISTINCT company, segment, region FROM competitors WHERE TRIM(COALESCE(company,'')) <> ''`
      );
      message = `Пробелы убраны. Заполнено сегментов/регионов по справочнику: ${filled.rowsAffected || 0}. Компаний добавлено в справочник: ${added.rowsAffected || 0}.`;

    } else if (taskType === 'fix_links') {
      // Ищет строки, которые «висят в воздухе»: конкурент привязан к подразделению
      // текстом (competitors.unit), и если название разошлось с оргструктурой,
      // строка не видна никому. Раньше функция не выполняла ни одного запроса.
      const orphanComp = await queryAll(
        `SELECT DISTINCT unit FROM competitors WHERE unit NOT IN (SELECT unit FROM divisions) ORDER BY unit`
      );
      const orphanSurv = await queryAll(
        `SELECT DISTINCT unit FROM surveys WHERE state != 'удалена' AND unit NOT IN (SELECT unit FROM divisions) ORDER BY unit`
      );
      const synced = await run(
        `UPDATE competitors SET
           dir  = COALESCE((SELECT d.dir  FROM divisions d WHERE d.unit = competitors.unit), dir),
           resp = COALESCE((SELECT d.resp FROM divisions d WHERE d.unit = competitors.unit), resp),
           hrbp = COALESCE((SELECT d.hrbp FROM divisions d WHERE d.unit = competitors.unit), hrbp)
         WHERE unit IN (SELECT unit FROM divisions)`
      );
      const names = orphanComp.map(x => x.unit).concat(orphanSurv.map(x => x.unit));
      const uniq = Array.from(new Set(names));
      message = uniq.length
        ? `Обновлено связей с оргструктурой: ${synced.rowsAffected || 0}. Не найдены в оргструктуре (${uniq.length}): ${uniq.slice(0, 10).join(', ')}${uniq.length > 10 ? '…' : ''}`
        : `Обновлено связей с оргструктурой: ${synced.rowsAffected || 0}. Потерянных привязок нет.`;

    } else if (taskType === 'mass_reminder') {
      const r = await sendMassReminder(req.user.fio);
      message = `Напоминания успешно отправлены: ${r.sent} сотрудникам.`;
    } else {
      return res.status(400).json({ ok: false, error: 'Неизвестная сервисная задача' });
    }

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'сервис ' + taskType,
      message
    ]);

    res.json({ ok: true, message });
  } catch (err) {
    console.error('runMaintenance error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка выполнения сервисной задачи' });
  }
};

exports.getAuditLog = async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);

  try {
    const logs = await queryAll('SELECT id, login, action, detail, ip, created_at FROM audit_log ORDER BY id DESC LIMIT ?', [limit]);

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
  } catch (err) {
    console.error('getAuditLog error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка загрузки журнала аудита' });
  }
};
