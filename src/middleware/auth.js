const jwt = require('jsonwebtoken');
const config = require('../config');
const { queryOne } = require('../db/database');

async function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['x-token'];
  let token = null;

  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else {
      token = authHeader.trim();
    }
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ ok: false, error: 'AUTH_REQUIRED', message: 'Требуется авторизация' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await queryOne(
      'SELECT id, login, fio, role, phone, units, active, last_login_at FROM users WHERE LOWER(login) = LOWER(?)',
      [decoded.login]
    );

    if (!user) {
      return res.status(401).json({ ok: false, error: 'USER_NOT_FOUND', message: 'Пользователь не найден' });
    }

    if (!user.active) {
      return res.status(403).json({ ok: false, error: 'USER_BLOCKED', message: 'Учетная запись заблокирована' });
    }

    req.user = {
      ...user,
      units: user.units ? user.units.split(';').map(s => s.trim()).filter(Boolean) : []
    };

    next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: 'AUTH_INVALID', message: 'Сессия истекла или недействительна' });
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
    }
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: 'ACCESS_DENIED', message: 'Недостаточно прав доступа' });
    }
    next();
  };
}

module.exports = {
  authMiddleware,
  requireRoles
};
