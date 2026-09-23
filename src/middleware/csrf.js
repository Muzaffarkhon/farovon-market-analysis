'use strict';

/**
 * Защита от CSRF — двойная отправка токена (double-submit cookie). Сессия
 * принимается из httpOnly-куки `farovon_session` ИЛИ из заголовка
 * Authorization/X-Token (Telegram Mini App — куки не всегда доступны во
 * фрейме web.telegram.org, см. middleware/auth.js). Заголовок подделать
 * межсайтовым запросом нельзя без CORS-preflight, который сервер отклонит —
 * значит проверка нужна только для запросов, аутентифицированных именно
 * кукой.
 *
 * Куку `farovon_csrf` ставит authController рядом с сессионной (см.
 * setCsrfCookie) — не httpOnly специально, её должен прочитать клиентский
 * JS и вернуть тем же значением в заголовке `X-CSRF-Token`. Атакующая
 * страница может заставить браузер отправить куку автоматически, но не
 * может её прочитать (чужой origin) и подставить в заголовок.
 */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function csrfProtect(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) return next();

  const authHeader = req.headers['authorization'] || req.headers['x-token'];
  if (authHeader) return next(); // токен в заголовке — не кука, CSRF не грозит

  const m = /(?:^|;\s*)farovon_csrf=([^;]+)/.exec(req.headers.cookie || '');
  const cookieToken = m ? decodeURIComponent(m[1]) : null;
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({
      ok: false,
      error: 'CSRF_TOKEN_MISMATCH',
      message: 'Обновите страницу и попробуйте снова'
    });
  }
  next();
}

module.exports = { csrfProtect };
