const jwt = require('jsonwebtoken');
const config = require('../config');
const { queryOne } = require('../db/database');
const { effectiveUnitsForUser } = require('../services/userScopeService');

async function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['x-token'];
  let token = null;

  // Токен принимаем из заголовка. Раньше был ещё и ?token= в query — такие
  // токены оседают в логах доступа, Referer и истории браузера.
  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else {
      token = authHeader.trim();
    }
  }

  // #22 — фолбэк на httpOnly-куку сессии (не читается из JS, не уязвима к XSS).
  // Заголовок остаётся для Telegram Mini App: там страница крутится во фрейме
  // web.telegram.org, а межсайтовые куки браузеры всё чаще блокируют.
  if (!token && req.headers.cookie) {
    const m = /(?:^|;\s*)farovon_session=([^;]+)/.exec(req.headers.cookie);
    if (m) {
      try { token = decodeURIComponent(m[1]); } catch (e) { token = m[1]; }
    }
  }

  if (!token) {
    return res.status(401).json({ ok: false, error: 'AUTH_REQUIRED', message: 'Требуется авторизация' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    const user = await queryOne(
      "SELECT id, login, fio, role, phone, units, active, last_login_at, telegram_chat_id, must_change_password, onboarded_at FROM users WHERE LOWER(login) = LOWER(?) AND archived_at IS NULL",
      [decoded.login]
    );

    if (!user) {
      return res.status(401).json({ ok: false, error: 'USER_NOT_FOUND', message: 'Пользователь не найден' });
    }

    if (!user.active) {
      return res.status(403).json({ ok: false, error: 'USER_BLOCKED', message: 'Учетная запись заблокирована' });
    }

    // Права на подразделения/направления решаются по ID-связи
    // (user_division_scope/user_direction_scope), не по совпадению текста —
    // переименование подразделения не должно рвать доступ. Текстовое поле
    // units — запасной вариант на случай, если ID-связь ещё не подтянулась
    // (гонка сразу после записи до пересинхронизации).
    let units = [];
    try {
      units = await effectiveUnitsForUser(user.id);
    } catch (e) {
      console.error('effectiveUnitsForUser error:', e);
    }
    if (!units.length && user.units) {
      units = user.units.split(';').map(s => s.trim()).filter(Boolean);
    }
    req.user = { ...user, units };
    // Клеймы токена (sess — начало сессии) нужны /auth/resume для проверки
    // абсолютного потолка жизни сессии.
    req.tokenClaims = decoded;

    // Вошёл по временному паролю — до его смены пускаем только на смену пароля
    // и обновление сессии. Остальные эндпоинты закрыты.
    if (user.must_change_password) {
      const allowed = /\/auth\/(change-password|resume)$/.test(req.path || req.url || '');
      if (!allowed) {
        return res.status(403).json({
          ok: false, error: 'PASSWORD_CHANGE_REQUIRED',
          message: 'Сначала смените временный пароль'
        });
      }
    }

    next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: 'AUTH_INVALID', message: 'Сессия истекла или недействительна' });
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: 'Требуется авторизация', message: 'Требуется авторизация' });
    }
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: 'Недостаточно прав доступа', message: 'Недостаточно прав доступа' });
    }
    next();
  };
}

/** Персональная запись права активна, если срока нет или он ещё не наступил (ISO-строки сравнимы лексикографически). */
function isPersonalActive(row, nowIso) {
  if (!row) return false;
  if (!row.expires_at) return true;
  return String(row.expires_at) > String(nowIso);
}

/**
 * Ядро проверки по конструктору ролей и доступов (см. src/config/capabilities.js).
 * 'admin' всегда возвращает true без обращения к таблице — защищённая роль,
 * не может быть урезана через конструктор ни при каких обстоятельствах.
 *
 * Экспортируется отдельно от requireCapability, чтобы контроллеры, где один
 * маршрут обслуживает два разных действия (saveUser — и создание, и правку
 * одним POST), могли различить их внутри обработчика, а не только на уровне
 * маршрута.
 */
async function hasCapability(user, capability) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  try {
    // Личная запись по праву (если есть) перекрывает роль: 'deny' — отключено
    // конкретному сотруднику, даже если роль его даёт; 'grant' — выдано сверху.
    const [personalRow, roleRow] = await Promise.all([
      queryOne('SELECT effect, expires_at FROM user_capabilities WHERE user_login = ? AND capability = ?', [user.login, capability]),
      queryOne('SELECT 1 AS by_role FROM role_capabilities WHERE role = ? AND capability = ?', [user.role, capability])
    ]);
    // Просроченная персональная запись (expires_at в прошлом) не учитывается —
    // ни как выдача, ни как отключение.
    const personal = isPersonalActive(personalRow, new Date().toISOString()) ? (personalRow.effect || 'grant') : null;
    if (personal === 'deny') return false;
    return personal === 'grant' || !!(roleRow && roleRow.by_role);
  } catch (err) {
    console.error('hasCapability error:', err.message);
    // Таблицы может не быть, если сервер поднялся раньше миграции (см.
    // server.js — миграция не блокирует старт). Отказываем в доступе, а не
    // роняем запрос: 500 на живом проде хуже, чем временное «нет прав».
    return false;
  }
}

/** Доступ к маршруту разрешён, если у роли есть хотя бы одно из перечисленных прав. */
function requireCapability(...capabilities) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: 'Требуется авторизация', message: 'Требуется авторизация' });
    }
    for (const cap of capabilities) {
      if (await hasCapability(req.user, cap)) return next();
    }
    return res.status(403).json({ ok: false, error: 'Недостаточно прав доступа', message: 'Недостаточно прав доступа' });
  };
}

module.exports = {
  isPersonalActive,
  authMiddleware,
  requireRoles,
  requireCapability,
  hasCapability
};
