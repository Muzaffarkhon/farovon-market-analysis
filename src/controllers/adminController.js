const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { queryAll, queryOne, run, batch } = require('../db/database');
const { sendMassReminder } = require('../services/telegramService');
const { CAPABILITIES, ROLES } = require('../config/capabilities');
const { hasCapability } = require('../middleware/auth');

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

/**
 * Защита учётной записи администратора.
 *
 * Заблокированный или заархивированный админ не может войти — а войти под
 * другим админом может быть уже некому. Это необратимая потеря доступа ко
 * всей системе, поэтому проверка стоит на сервере: прятать кнопки в интерфейсе
 * недостаточно, эндпоинты вызываются и напрямую.
 *
 * Путей отключить админа было три, закрыты все: «Заблокировать», «В архив» и
 * правка карточки (там есть и флаг active, и смена роли).
 *
 * Возвращает текст ошибки либо null, если действие разрешено.
 */
function guardAdmin(actor, target, verb) {
  if (!target) return null;
  if (String(actor.login).toLowerCase() === String(target.login).toLowerCase()) {
    return `Нельзя ${verb} собственную учётную запись`;
  }
  if (target.role === 'admin') {
    return `Учётную запись администратора нельзя ${verb}. ` +
           'Сначала передайте роль администратора другому сотруднику.';
  }
  return null;
}

/**
 * Сколько администраторов останется, если у этого забрать роль. Нужен, чтобы
 * смена роли не стала обходным путём: снять «админа», а потом заблокировать.
 */
async function otherActiveAdmins(login) {
  const row = await queryOne(
    `SELECT COUNT(*) AS n FROM users
      WHERE role = 'admin' AND active = 1 AND archived_at IS NULL
        AND LOWER(login) <> LOWER(?)`, [login]);
  return (row && row.n) || 0;
}

exports.saveUser = async (req, res) => {
  const { fio, role, phone, password, active, units } = req.body;
  let { login } = req.body;

  if (!fio || !String(fio).trim()) {
    return res.status(400).json({ ok: false, error: 'Укажите ФИО пользователя' });
  }

  const targetRole = String(role || 'user').trim().toLowerCase();
  const VALID_ROLES = ['admin', 'cb', 'hrbp', 'dir_head', 'head', 'user'];
  if (!VALID_ROLES.includes(targetRole)) {
    return res.status(400).json({ ok: false, error: 'Недопустимая роль пользователя. Допустимы: admin, cb, hrbp, dir_head, head, user' });
  }

  try {
    const cleanLogin = login ? String(login).trim().toLowerCase() : '';
    const existing = cleanLogin ? await queryOne('SELECT * FROM users WHERE LOWER(login) = LOWER(?)', [cleanLogin]) : null;

    // Маршрут пускает по users:create ИЛИ users:edit (см. routes/api.js) —
    // точная граница между «добавить» и «править» зависит от того, нашёлся
    // ли пользователь, и это известно только здесь.
    const needed = existing ? 'users:edit' : 'users:create';
    if (!(await hasCapability(req.user, needed))) {
      return res.status(403).json({ ok: false, error: 'Недостаточно прав доступа' });
    }

    const unitsStr = Array.isArray(units) ? units.join('; ') : (units || '');
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');

    if (existing) {
      // Редактирование
      const newRole = targetRole;

      // Через карточку админа тоже можно было и разжаловать, и снять галочку
      // «активен» — те же последствия, что и «Заблокировать».
      if (existing.role === 'admin') {
        const left = await otherActiveAdmins(existing.login);
        if (newRole !== 'admin' && left === 0) {
          return res.status(400).json({
            ok: false,
            error: 'Это единственный администратор. Сначала назначьте администратором кого-то ещё.'
          });
        }
        if (active === false) {
          return res.status(400).json({
            ok: false,
            error: 'Учётную запись администратора нельзя перевести в неактивные.'
          });
        }
      }

      const hash = (password && String(password).trim()) ? hashPassword(String(password).trim()) : null;

      await run(`
        UPDATE users
        SET fio = ?, role = ?, phone = ?, password_hash = COALESCE(?, password_hash), active = ?, units = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [String(fio).trim(), newRole, cleanPhone || null, hash, active !== false ? 1 : 0, unitsStr, existing.id]);

      await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
        req.user.login,
        'админ правка пользователя',
        `Логин: ${existing.login}, ФИО: ${fio}, Роль: ${newRole}`
      ]);

      return res.json({ ok: true, login: existing.login, message: 'Пользователь обновлён' });
    } else {
      // Создание
      let finalLogin = cleanLogin;
      if (!finalLogin) {
        const allUsers = await queryAll('SELECT login FROM users');
        const allLogins = {};
        allUsers.forEach(x => { allLogins[x.login.toLowerCase()] = true; });
        finalLogin = makeLogin(String(fio).trim(), allLogins);
      }

      const rawPwd = (password && String(password).trim()) ? String(password).trim() : makePassword();
      const hash = hashPassword(rawPwd);

      await run(`
        INSERT INTO users (login, password_hash, fio, role, phone, units, active)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [finalLogin, hash, String(fio).trim(), targetRole, cleanPhone || null, unitsStr, active !== false ? 1 : 0]);

      await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
        req.user.login,
        'админ создание пользователя',
        `Логин: ${finalLogin}, ФИО: ${fio}, Роль: ${targetRole}`
      ]);

      return res.json({ ok: true, login: finalLogin, rawPassword: rawPwd, message: 'Пользователь создан' });
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
    const user = await queryOne('SELECT id, login, role FROM users WHERE LOWER(login) = LOWER(?)', [login]);
    if (!user) return res.status(404).json({ ok: false, error: 'Пользователь не найден' });

    // Разблокировать можно кого угодно — необратимых последствий у этого нет.
    if (!active) {
      const deny = guardAdmin(req.user, user, 'заблокировать');
      if (deny) return res.status(403).json({ ok: false, error: deny });
    }

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

    // Прежняя проверка ловила только «админ архивирует сам себя»: другой админ
    // или C&B-аналитик мог отправить администратора в архив, а архивный войти
    // уже не может.
    const deny = guardAdmin(req.user, user, 'архивировать');
    if (deny) return res.status(403).json({ ok: false, error: deny });

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
    // dir_head видит и правит только отделы своего направления — не всю
    // оргструктуру. Своё направление ему закрепляет администратор (units).
    if (req.user.role === 'dir_head') {
      const myDirs = req.user.units || [];
      if (!myDirs.length) return res.json({ ok: true, divisions: [] });
      const placeholders = myDirs.map(() => '?').join(',');
      const divisions = await queryAll(
        `SELECT * FROM divisions WHERE dir IN (${placeholders}) ORDER BY num ASC, unit ASC`, myDirs);
      return res.json({ ok: true, divisions });
    }

    const divisions = await queryAll('SELECT * FROM divisions ORDER BY num ASC, unit ASC');
    res.json({ ok: true, divisions });
  } catch (err) {
    console.error('getDivisions error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка загрузки подразделений' });
  }
};

exports.saveDivision = async (req, res) => {
  const { unit, dir, head, resp, hrbp, note, group, org_role, is_survey_target } = req.body;
  if (!unit || !String(unit).trim()) {
    return res.status(400).json({ ok: false, error: 'Укажите название подразделения' });
  }

  const cleanUnit = String(unit).trim();
  const cleanDir = dir !== undefined && dir !== null ? String(dir).trim() : null;

  try {
    const isAdmin = req.user.role === 'admin' || req.user.role === 'cb';

    // dir_head назначает ответственных только по отделам СВОЕГО направления —
    // само направление (dir) и его руководителя (head) на уровне департамента
    // он менять не может, это была бы самоназначаемая смена зоны ответственности.
    // Проверка на сервере, а не только скрытая кнопка на фронте: маршрут
    // доступен dir_head напрямую.
    if (!isAdmin) {
      if (req.user.role !== 'dir_head') {
        return res.status(403).json({ ok: false, error: 'Недостаточно прав' });
      }
      const division = await queryOne('SELECT * FROM divisions WHERE unit = ?', [cleanUnit]);
      if (!division) return res.status(404).json({ ok: false, error: 'Подразделение не найдено' });

      const myDirs = req.user.units || [];
      const inMyDirection = myDirs.includes(division.dir) || myDirs.includes(division.unit);
      if (!inMyDirection) {
        return res.status(403).json({
          ok: false,
          error: 'Можно назначать ответственных только по отделам своего направления'
        });
      }
      if (cleanDir !== null && cleanDir !== division.dir) {
        return res.status(403).json({ ok: false, error: 'Менять направление отдела нельзя' });
      }

      await run(`
        UPDATE divisions
        SET head = COALESCE(?, head),
            resp = COALESCE(?, resp),
            note = COALESCE(?, note),
            updated_at = CURRENT_TIMESTAMP
        WHERE unit = ?
      `, [head, resp, note, cleanUnit]);

      // Сквозное обновление подразделения сотрудника в таблице пользователей
      if (resp || head) {
        await run('UPDATE users SET unit = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(fio) = LOWER(?)', [cleanUnit, resp || head]);
      }

      await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
        req.user.login,
        'правка подразделения (dir_head)',
        `Подразделение: ${cleanUnit}, Рук: ${head}, Отв: ${resp}`
      ]);

      return res.json({ ok: true, message: 'Подразделение обновлено' });
    }

    const cleanGroup = group !== undefined && group !== null ? String(group).trim() : null;
    const cleanOrgRole = org_role !== undefined && org_role !== null ? String(org_role).trim() : null;
    const cleanSurveyTarget = is_survey_target !== undefined && is_survey_target !== null ? Number(is_survey_target) : null;

    await run(`
      UPDATE divisions
      SET dir = COALESCE(?, dir),
          head = COALESCE(?, head),
          resp = COALESCE(?, resp),
          hrbp = COALESCE(?, hrbp),
          note = COALESCE(?, note),
          group_key = COALESCE(?, group_key),
          org_role = COALESCE(?, org_role),
          is_survey_target = COALESCE(?, is_survey_target),
          updated_at = CURRENT_TIMESTAMP
      WHERE unit = ?
    `, [cleanDir, head, resp, hrbp, note, cleanGroup, cleanOrgRole, cleanSurveyTarget, cleanUnit]);

    // Сквозное обновление подразделения сотрудника в таблице пользователей
    const assignedPerson = resp || head || hrbp;
    if (assignedPerson) {
      await run('UPDATE users SET unit = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(fio) = LOWER(?)', [cleanUnit, assignedPerson]);
    }

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'правка подразделения',
      `Подразделение: ${cleanUnit}, Рук: ${head}, Отв: ${resp}, HRBP: ${hrbp}`
    ]);

    res.json({ ok: true, message: 'Подразделение обновлено' });
  } catch (err) {
    console.error('saveDivision error:', err && err.message ? err.message : err);
    res.status(500).json({ ok: false, error: (err && err.message) || 'Ошибка сохранения подразделения' });
  }
};

exports.moveDivisionCascade = async (req, res) => {
  const { unit, targetDir, parentUnit, cascadeCompetitors } = req.body;
  if (!unit || !targetDir) {
    return res.status(400).json({ ok: false, error: 'Укажите подразделение и целевое направление' });
  }

  const cleanUnit = String(unit).trim();
  const cleanTargetDir = String(targetDir).trim();
  const cleanParentUnit = parentUnit ? String(parentUnit).trim() : null;

  try {
    const existing = await queryOne('SELECT * FROM divisions WHERE unit = ?', [cleanUnit]);
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Подразделение не найдено' });
    }

    const oldDir = existing.dir;
    const oldParentUnit = existing.parent_unit || null;

    // 1. Обновляем divisions: dir и parent_unit
    await run('UPDATE divisions SET dir = ?, parent_unit = ?, updated_at = CURRENT_TIMESTAMP WHERE unit = ?',
      [cleanTargetDir, cleanParentUnit, cleanUnit]);

    // 2. Каскадное обновление в competitors (если включено или по умолчанию)
    let compUpdated = 0;
    if (cascadeCompetitors !== false) {
      const compResult = await run('UPDATE competitors SET dir = ? WHERE unit = ?', [cleanTargetDir, cleanUnit]);
      compUpdated = (compResult && compResult.changes) || 0;
    }

    // 3. Запись в аудит-лог
    const hierarchyStr = cleanParentUnit
      ? `Уровень 4: подотдел "${cleanUnit}" внутри "${cleanParentUnit}" (напр.: "${cleanTargetDir}")`
      : `Перенос "${cleanUnit}" из "${oldDir || 'Без направления'}" в напр.: "${cleanTargetDir}".Связей участников: ${compUpdated}`;

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'каскадный перенос подразделения',
      hierarchyStr
    ]);

    res.json({
      ok: true,
      message: cleanParentUnit
        ? `Подразделение «${cleanUnit}» прикреплено под «${cleanParentUnit}»`
        : `Подразделение «${cleanUnit}» перенесено в «${cleanTargetDir}»`,
      unit: cleanUnit,
      oldDir,
      oldParentUnit,
      newDir: cleanTargetDir,
      newParentUnit: cleanParentUnit,
      competitorsUpdated: compUpdated
    });
  } catch (err) {
    console.error('moveDivisionCascade error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка перемещения подразделения' });
  }
};

exports.batchAssignCascade = async (req, res) => {
  const { dir, roleType, personName } = req.body;
  if (!dir || !roleType || personName === undefined) {
    return res.status(400).json({ ok: false, error: 'Укажите направление, тип роли (head/hrbp/resp) и ФИО сотрудника' });
  }

  const cleanDir = String(dir).trim();
  const cleanPerson = String(personName || '').trim();

  try {
    let divResult;
    if (roleType === 'hrbp') {
      divResult = await run('UPDATE divisions SET hrbp = ?, updated_at = CURRENT_TIMESTAMP WHERE dir = ?', [cleanPerson, cleanDir]);
      // Каскадно обновляем competitors
      await run('UPDATE competitors SET hrbp = ? WHERE dir = ?', [cleanPerson, cleanDir]);
    } else if (roleType === 'head') {
      divResult = await run('UPDATE divisions SET head = ?, updated_at = CURRENT_TIMESTAMP WHERE dir = ?', [cleanPerson, cleanDir]);
    } else if (roleType === 'resp') {
      divResult = await run('UPDATE divisions SET resp = ?, updated_at = CURRENT_TIMESTAMP WHERE dir = ?', [cleanPerson, cleanDir]);
    } else {
      return res.status(400).json({ ok: false, error: 'Неизвестный тип роли' });
    }

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'каскадное назначение роли',
      `Направление "${cleanDir}": ${roleType} -> "${cleanPerson || 'Сброшено'}" (подразделений: ${(divResult && divResult.changes) || 0})`
    ]);

    res.json({
      ok: true,
      message: `Роль успешно назначена на направление "${cleanDir}"`,
      affectedDivisions: (divResult && divResult.changes) || 0
    });
  } catch (err) {
    console.error('batchAssignCascade error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка каскадного назначения' });
  }
};

// ─── Период сбора ───
exports.setPeriod = async (req, res) => {
  const { state, name, from, to } = req.body;

  const cleanName = (name && String(name).trim()) ? String(name).trim() : 'Обзор рынка';
  let cleanState = String(state || 'открыт').trim().toLowerCase();
  if (!['открыт', 'закрыт'].includes(cleanState)) {
    cleanState = 'открыт';
  }

  if (from && to && String(from).trim() && String(to).trim()) {
    const dFrom = new Date(from);
    const dTo = new Date(to);
    if (!isNaN(dFrom.getTime()) && !isNaN(dTo.getTime()) && dFrom > dTo) {
      return res.status(400).json({ ok: false, error: 'Дата начала периода не может быть позже даты окончания' });
    }
  }

  try {
    await run(`
      INSERT INTO periods (name, state, from_date, to_date, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [cleanName, cleanState, from || null, to || null, req.user.fio || req.user.login]);

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'период сбора',
      `Период: ${cleanName}, Статус: ${cleanState}`
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
/**
 * Загрузка штатного расписания: 1340 пар «должность × подразделение» по 285
 * отделам плюс код отдела.
 *
 * До этого привязки должности к подразделению в схеме не существовало вовсе —
 * список должностей был общим на весь холдинг (216 позиций), и экран шага 2
 * писал «штатка не заведена» для любого подразделения.
 *
 * Данные лежат файлом в репозитории, а не заливаются скриптом снаружи: доступа
 * к живой базе у разработчика нет и быть не должно, поэтому загрузку запускает
 * админ кнопкой. Повторный запуск безопасен — INSERT OR IGNORE и UPDATE.
 */
async function importStaffing() {
  const data = require('../data/staffing.json');

  const known = await queryAll('SELECT unit FROM divisions');
  const knownSet = new Set(known.map(d => String(d.unit || '').trim()));

  let pairs = 0;
  let skipped = 0;
  const positions = new Set();

  // Пишем пачками: 1340 отдельных запросов к Turso — это 1340 сетевых
  // обращений, батч укладывается в считанные секунды.
  const stmts = [];
  for (const s of data.staff) {
    if (!knownSet.has(s.u)) { skipped++; continue; }
    positions.add(s.p);
    stmts.push({
      sql: 'INSERT OR IGNORE INTO unit_positions (unit, position, staff_count) VALUES (?, ?, ?)',
      args: [s.u, s.p, s.n || 0]
    });
    pairs++;
  }

  // Должность обязана быть и в общем справочнике: пикер «Должность в компании»
  // работает по нему.
  for (const p of positions) {
    stmts.push({ sql: 'INSERT OR IGNORE INTO dictionary_positions (name) VALUES (?)', args: [p] });
  }

  for (const [unit, code] of Object.entries(data.codes || {})) {
    if (!knownSet.has(unit)) continue;
    stmts.push({ sql: 'UPDATE divisions SET code = ? WHERE unit = ?', args: [code, unit] });
  }

  for (let i = 0; i < stmts.length; i += 200) {
    await batch(stmts.slice(i, i + 200));
  }

  const total = await queryOne('SELECT COUNT(*) AS n FROM unit_positions');
  const units = await queryOne('SELECT COUNT(DISTINCT unit) AS n FROM unit_positions');

  return `Штатное расписание загружено. Пар «должность × подразделение»: ${(total && total.n) || 0} ` +
         `по ${(units && units.n) || 0} подразделениям, должностей в справочнике добавлено/сверено: ${positions.size}. ` +
         `Кодов отделов проставлено: ${Object.keys(data.codes || {}).length}.` +
         (skipped ? ` Пропущено строк (подразделения нет в оргструктуре): ${skipped}.` : '');
}

/**
 * Проставляет компаниям направления и коды-идентификаторы по фактическому
 * использованию в листе участников рынка.
 *
 * Поле «Направления» у компании заводилось руками и поэтому пустовало у всех
 * 188 записей: в таблице справочника было видно «Использований 2», а внутри
 * карточки — ни одного отмеченного направления. Это не расхождение данных:
 * «использований» считается по строкам участников рынка, а направление до сих
 * пор никто не проставлял. Теперь оно выводится из тех же строк.
 */
async function importCompanyDirs() {
  const data = require('../data/companiesImport.json');

  const rows = await queryAll('SELECT name FROM dictionary_companies');
  const byLower = new Map();
  rows.forEach(r => byLower.set(String(r.name || '').trim().toLowerCase(), r.name));

  const stmts = [];
  let updated = 0;
  let added = 0;

  for (const c of data.companies) {
    const existing = byLower.get(c.name.trim().toLowerCase());
    if (!existing) {
      stmts.push({
        sql: 'INSERT OR IGNORE INTO dictionary_companies (name, segment, region, dirs, code) VALUES (?, ?, ?, ?, ?)',
        args: [c.name, c.seg || '', c.reg || '', (c.dirs || []).join(';'), c.code || '']
      });
      added++;
      continue;
    }
    // Направления и код перезаписываем, сегмент/регион — только если пусты:
    // их мог поправить руками админ, и затирать эту правку нельзя.
    stmts.push({
      sql: `UPDATE dictionary_companies
              SET dirs = ?, code = ?,
                  segment = CASE WHEN TRIM(COALESCE(segment,'')) = '' THEN ? ELSE segment END,
                  region  = CASE WHEN TRIM(COALESCE(region,'')) = ''  THEN ? ELSE region  END
            WHERE name = ?`,
      args: [(c.dirs || []).join(';'), c.code || '', c.seg || '', c.reg || '', existing]
    });
    updated++;
  }

  for (let i = 0; i < stmts.length; i += 200) {
    await batch(stmts.slice(i, i + 200));
  }

  const withDirs = await queryOne(
    "SELECT COUNT(*) AS n FROM dictionary_companies WHERE TRIM(COALESCE(dirs,'')) <> ''");

  return `Компании сверены с листом участников рынка. Обновлено: ${updated}, добавлено новых: ${added}. ` +
         `Направления проставлены у ${(withDirs && withDirs.n) || 0} компаний.`;
}

/** Метка источника у строк, созданных раздачей по направлению. */
const AUTO_SRC = 'по направлению';

/**
 * Устойчивый идентификатор: одна и та же пара «подразделение + компания»
 * всегда даёт один cid, поэтому повторный запуск не плодит дубли.
 */
function autoCid(unit, company) {
  const h = crypto.createHash('sha1').update(unit + '|' + company).digest('hex');
  return 'D' + h.slice(0, 12).toUpperCase();
}

/**
 * Раздача компаний пустым подразделениям — ровно по той схеме, что уже
 * заложена в листе «Конкуренты».
 *
 * В листе у каждого из 22 направлений есть строки, заведённые на самом
 * направлении (подразделение = направление) — это базовый набор направления,
 * 4–18 компаний. Кроме них отдельные отделы имеют собственные добавления.
 *
 * Раздаём именно базовый набор и только тем отделам, у которых сейчас нет ни
 * одной компании. Брать объединение всех компаний направления неправильно:
 * тогда отдел получал бы до 57 компаний вместо привычных восьми, а вместе с
 * ними и чужие добавления соседних отделов — всего вышло бы 7290 строк вместо
 * 2914. Отделы, где компании уже есть, не трогаем: там выбор сделан вручную.
 */
async function distributeCompanies(confirm) {
  const divs = await queryAll(
    "SELECT unit, dir, resp, hrbp FROM divisions WHERE TRIM(COALESCE(dir,'')) <> ''");
  const comps = await queryAll('SELECT unit, company, segment, region FROM competitors');

  const dirNames = new Set(divs.map(d => String(d.dir).trim()));
  const busy = new Set(comps.map(c => c.unit));

  // Базовый набор направления — строки, где подразделение совпадает с ним самим.
  const base = new Map();
  comps.forEach(c => {
    const u = String(c.unit || '').trim();
    if (!dirNames.has(u)) return;
    if (!base.has(u)) base.set(u, new Map());
    if (!base.get(u).has(c.company)) base.get(u).set(c.company, c);
  });

  const planned = [];
  const perDir = new Map();
  for (const d of divs) {
    const set = base.get(String(d.dir).trim());
    if (!set || busy.has(d.unit)) continue;
    for (const c of set.values()) {
      planned.push({ d, c });
      perDir.set(d.dir, (perDir.get(d.dir) || 0) + 1);
    }
  }

  const top = [...perDir.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([d, n]) => `${d} — ${n}`).join('; ');

  if (!confirm) {
    return {
      needsConfirm: true,
      total: planned.length,
      message: planned.length
        ? `Подразделений без единой компании: ${new Set(planned.map(p => p.d.unit)).size}. ` +
          `Каждое получит базовый набор своего направления — тот, что заведён в листе ` +
          `на самом направлении. Всего строк: ${planned.length} (сейчас в базе ${comps.length}). ` +
          `Больше всего: ${top}. Отделы, где компании уже есть, не затрагиваются. ` +
          'Новые строки получат статус «уточнить» и метку «по направлению» — их можно убрать одной кнопкой.'
        : 'Добавлять нечего: у всех подразделений с направлением уже есть компании.'
    };
  }

  const stmts = planned.map(({ d, c }) => ({
    sql: `INSERT OR IGNORE INTO competitors
            (cid, unit, dir, resp, hrbp, company, segment, region, actual, src)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'уточнить', ?)`,
    args: [autoCid(d.unit, c.company), d.unit, d.dir, d.resp || '', d.hrbp || '',
           c.company, c.segment || '', c.region || '', AUTO_SRC]
  }));

  for (let i = 0; i < stmts.length; i += 200) {
    await batch(stmts.slice(i, i + 200));
  }

  const now = await queryOne('SELECT COUNT(*) AS n FROM competitors');
  const units = await queryOne('SELECT COUNT(DISTINCT unit) AS n FROM competitors');
  return {
    message: `Компании разданы по направлениям. Добавлено строк: ${planned.length}. ` +
             `Всего участников рынка: ${(now && now.n) || 0} по ${(units && units.n) || 0} подразделениям.`
  };
}

/**
 * Откат раздачи. Убираются только строки с меткой «по направлению», которых
 * никто не касался: если по компании уже отметили актуальность или оставили
 * комментарий, строка остаётся — это уже работа руководителя, а не вставка.
 */
async function undoDistribute(confirm) {
  const cond = `src = ? AND COALESCE(actual,'уточнить') = 'уточнить'
                AND TRIM(COALESCE(updated_by,'')) = '' AND TRIM(COALESCE(note,'')) = ''`;
  const cnt = await queryOne(`SELECT COUNT(*) AS n FROM competitors WHERE ${cond}`, [AUTO_SRC]);
  const kept = await queryOne(
    `SELECT COUNT(*) AS n FROM competitors WHERE src = ? AND NOT (${cond})`, [AUTO_SRC, AUTO_SRC]);
  const n = (cnt && cnt.n) || 0;

  if (!confirm) {
    return {
      needsConfirm: true,
      total: n,
      message: n
        ? `Будет удалено строк: ${n}. Строки, по которым уже работали, останутся` +
          ((kept && kept.n) ? `: ${kept.n}` : '') + '.'
        : 'Убирать нечего: строк с меткой «по направлению» и без правок нет.'
    };
  }

  await run(`DELETE FROM competitors WHERE ${cond}`, [AUTO_SRC]);
  return { message: `Раздача отменена. Удалено строк: ${n}.` };
}

exports.runMaintenance = async (req, res) => {
  const { taskType, confirm } = req.body;

  try {
    // Задачи, меняющие данные массово, сначала показывают объём и ничего не
    // делают. Ответ с needsConfirm интерфейс превращает в диалог с цифрами.
    if (taskType === 'distribute_companies' || taskType === 'undo_distribute') {
      const fn = taskType === 'distribute_companies' ? distributeCompanies : undoDistribute;
      const r = await fn(confirm === true);
      if (r.needsConfirm) {
        return res.json({ ok: false, needsConfirm: true, total: r.total, message: r.message });
      }
      await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
        req.user.login, 'сервис ' + taskType, r.message
      ]);
      return res.json({ ok: true, message: r.message });
    }

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

    } else if (taskType === 'import_staffing') {
      message = await importStaffing();

    } else if (taskType === 'import_company_dirs') {
      message = await importCompanyDirs();

    } else if (taskType === 'mass_reminder') {
      const r = await sendMassReminder(req.user.fio);
      message = `Напоминания успешно отправлены: ${r.sent} сотрудникам.`;

    } else if (taskType === 'get_locks') {
      const compLocks = await queryAll(`
        SELECT TRIM(updated_by) AS owner, COUNT(*) AS n 
        FROM competitors 
        WHERE TRIM(COALESCE(updated_by, '')) <> '' 
        GROUP BY TRIM(updated_by)
      `);
      const survLocks = await queryAll(`
        SELECT TRIM(created_by) AS owner, COUNT(*) AS n 
        FROM surveys 
        WHERE state != 'удалена' AND TRIM(COALESCE(created_by, '')) <> '' 
        GROUP BY TRIM(created_by)
      `);
      const users = await queryAll('SELECT login, fio, role FROM users');
      const userMap = {};
      users.forEach(u => {
        if (u.login) userMap[u.login.toLowerCase()] = u;
        if (u.fio) userMap[u.fio.toLowerCase()] = u;
      });

      const combined = {};
      compLocks.forEach(c => {
        const key = c.owner;
        if (!combined[key]) combined[key] = { owner: key, comps: 0, survs: 0, role: 'user' };
        combined[key].comps = c.n;
        const u = userMap[key.toLowerCase()];
        if (u) combined[key].role = u.role;
        else if (/admin|администратор/i.test(key)) combined[key].role = 'admin';
        else if (/cb|с&b|c&b/i.test(key)) combined[key].role = 'cb';
      });
      survLocks.forEach(s => {
        const key = s.owner;
        if (!combined[key]) combined[key] = { owner: key, comps: 0, survs: 0, role: 'user' };
        combined[key].survs = s.n;
        const u = userMap[key.toLowerCase()];
        if (u) combined[key].role = u.role;
        else if (/admin|администратор/i.test(key)) combined[key].role = 'admin';
        else if (/cb|с&b|c&b/i.test(key)) combined[key].role = 'cb';
      });

      return res.json({ ok: true, locks: Object.values(combined) });

    } else if (taskType === 'unlock') {
      const { targetOwner, targetRole } = req.body;
      let compSql = '', survSql = '', compArgs = [], survArgs = [];

      if (targetRole) {
        const usersWithRole = await queryAll('SELECT login, fio FROM users WHERE role = ?', [targetRole]);
        const identifiers = [];
        usersWithRole.forEach(u => {
          if (u.login) identifiers.push(u.login);
          if (u.fio) identifiers.push(u.fio);
        });
        if (targetRole === 'admin') {
          identifiers.push('admin', 'Администратор', 'Администратор C&B', 'Администратор C&amp;B');
        } else if (targetRole === 'cb') {
          identifiers.push('cb', 'C&B', 'С&B');
        }
        if (identifiers.length) {
          const ph = identifiers.map(() => '?').join(',');
          compSql = `UPDATE competitors SET updated_by = '' WHERE updated_by IN (${ph})`;
          compArgs = identifiers;
          survSql = `UPDATE surveys SET created_by = '' WHERE created_by IN (${ph})`;
          survArgs = identifiers;
        }
      } else if (targetOwner && targetOwner !== 'all') {
        compSql = `UPDATE competitors SET updated_by = '' WHERE updated_by = ?`;
        compArgs = [targetOwner];
        survSql = `UPDATE surveys SET created_by = '' WHERE created_by = ?`;
        survArgs = [targetOwner];
      } else {
        // all
        compSql = `UPDATE competitors SET updated_by = '' WHERE TRIM(COALESCE(updated_by, '')) <> ''`;
        survSql = `UPDATE surveys SET created_by = '' WHERE TRIM(COALESCE(created_by, '')) <> ''`;
      }

      let countComp = 0, countSurv = 0;
      if (compSql) {
        const resComp = await run(compSql, compArgs);
        countComp = resComp.rowsAffected || 0;
      }
      if (survSql) {
        const resSurv = await run(survSql, survArgs);
        countSurv = resSurv.rowsAffected || 0;
      }

      const targetName = targetRole ? `роли "${targetRole}"` : (targetOwner && targetOwner !== 'all' ? `пользователя "${targetOwner}"` : 'со всех записей');
      message = `Блокировки ${targetName} успешно сняты. Разблокировано участников рынка: ${countComp}, записей должностей: ${countSurv}.`;

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

/**
 * Подпись действия для журнала.
 *
 * В живой базе колонка action у записей оказалась пустой, хотя код пишет её при
 * каждой вставке — из-за этого столбец «Действие» в журнале не показывал
 * ничего. Восстанавливаем подпись по тексту детали: она у каждого действия
 * своя и заполнена. Записи, сделанные после этой правки, приходят со своим
 * action и через подбор не проходят.
 */
function actionLabel(l) {
  const a = String(l.action || '').trim();
  if (a) return a;

  const d = String(l.detail || '');
  if (/успешная авторизаци/i.test(d)) return 'вход';
  if (/изменил свой пароль/i.test(d)) return 'смена пароля';
  if (/сохранено анкет/i.test(d)) return 'сохранение данных по должностям';
  if (/обновлено строк/i.test(d)) return 'сохранение участников рынка';
  if (/^Период:/i.test(d)) return 'период сбора';
  if (/^Подразделение:.*Рук:/i.test(d)) return 'правка подразделения';
  if (/^Логин:.*Роль:/i.test(d)) return 'правка пользователя';
  if (/^Логин:/i.test(d)) return 'действие с учётной записью';
  if (/нормализован|привязк|расхожден/i.test(d)) return 'сервисная утилита';
  return '—';
}

/**
 * Что сейчас реально лежит в базе по загружаемым данным.
 *
 * Без этого понять, отработала загрузка или нет, можно было только открыв
 * подразделение и посмотрев, появились ли должности, — а это ещё и зависело
 * от роли смотрящего. Цифры показываются прямо над кнопками загрузки.
 */
exports.getDataStatus = async (req, res) => {
  const num = async (sql) => {
    try {
      const r = await queryOne(sql);
      return (r && r.n) || 0;
    } catch (e) {
      return null; // таблицы/колонки ещё нет — миграция не прошла
    }
  };

  try {
    res.json({
      ok: true,
      status: {
        divisions: await num('SELECT COUNT(*) AS n FROM divisions'),
        divisionsWithCode: await num("SELECT COUNT(*) AS n FROM divisions WHERE TRIM(COALESCE(code,'')) <> ''"),
        staffPairs: await num('SELECT COUNT(*) AS n FROM unit_positions'),
        staffUnits: await num('SELECT COUNT(DISTINCT unit) AS n FROM unit_positions'),
        positions: await num('SELECT COUNT(*) AS n FROM dictionary_positions'),
        companies: await num('SELECT COUNT(*) AS n FROM dictionary_companies'),
        companiesWithDirs: await num("SELECT COUNT(*) AS n FROM dictionary_companies WHERE TRIM(COALESCE(dirs,'')) <> ''"),
        companiesWithCode: await num("SELECT COUNT(*) AS n FROM dictionary_companies WHERE TRIM(COALESCE(code,'')) <> ''"),
        competitors: await num('SELECT COUNT(*) AS n FROM competitors'),
        competitorUnits: await num('SELECT COUNT(DISTINCT unit) AS n FROM competitors'),
        surveys: await num("SELECT COUNT(*) AS n FROM surveys WHERE state != 'удалена'")
      }
    });
  } catch (err) {
    console.error('getDataStatus error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка получения состояния данных' });
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
        action: actionLabel(l),
        detail: l.detail || '',
        ip: l.ip || ''
      }))
    });
  } catch (err) {
    console.error('getAuditLog error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка загрузки журнала аудита' });
  }
};

// ─── Конструктор ролей и доступов ───
// Управляет только сам эндпоинт-редактор — admin-only, не requireCapability:
// давать C&B-аналитику менять права всей компании через настройку было бы
// той самой эскалацией прав, которую конструктор должен предотвращать.
// 'admin' в таблицу не пишется и не читается отсюда — у него все права
// всегда, это не настраивается (см. src/config/capabilities.js).
exports.getRoleCapabilities = async (req, res) => {
  try {
    const rows = await queryAll('SELECT role, capability FROM role_capabilities');
    const byRole = {};
    ROLES.forEach(r => { byRole[r] = []; });
    rows.forEach(r => {
      if (byRole[r.role]) byRole[r.role].push(r.capability);
    });

    res.json({ ok: true, roles: ROLES, capabilities: CAPABILITIES, matrix: byRole });
  } catch (err) {
    console.error('getRoleCapabilities error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка загрузки прав доступа' });
  }
};

exports.saveRoleCapabilities = async (req, res) => {
  const { role, capabilities } = req.body;

  if (!ROLES.includes(role)) {
    return res.status(400).json({ ok: false, error: 'Неизвестная или защищённая роль' });
  }
  const known = new Set(CAPABILITIES.map(c => c.id));
  const clean = Array.isArray(capabilities) ? capabilities.filter(c => known.has(c)) : [];

  try {
    await run('DELETE FROM role_capabilities WHERE role = ?', [role]);
    for (const cap of clean) {
      await run('INSERT OR IGNORE INTO role_capabilities (role, capability) VALUES (?, ?)', [role, cap]);
    }

    await run('INSERT INTO audit_log (login, action, detail) VALUES (?, ?, ?)', [
      req.user.login,
      'права доступа',
      `Роль: ${role}, прав: ${clean.length}`
    ]);

    res.json({ ok: true, capabilities: clean });
  } catch (err) {
    console.error('saveRoleCapabilities error:', err);
    res.status(500).json({ ok: false, error: 'Ошибка сохранения прав доступа' });
  }
};
