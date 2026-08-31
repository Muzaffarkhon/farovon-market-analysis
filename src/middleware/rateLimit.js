const rateLimit = require('express-rate-limit');

/**
 * Ограничители частоты запросов. До этого их не было вообще — /api/auth/login
 * можно было перебирать без единого препятствия.
 *
 * Ключ по умолчанию — IP клиента. Чтобы IP был реальным, а не адресом прокси
 * Render, в server.js выставлен `app.set('trust proxy', 1)`.
 *
 * standardHeaders: возвращаем RateLimit-* заголовки (RFC), legacyHeaders off.
 */

const json429 = (req, res) =>
  res.status(429).json({
    ok: false,
    error: 'RATE_LIMITED',
    message: 'Слишком много запросов. Повторите чуть позже.'
  });

// Широкий предохранитель на весь /api — от откровенного флуда. Обычному
// пользователю столько запросов за 5 минут не сделать даже при активной работе.
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json429
});

// Жёстко для входа: успешные запросы не считаем (skipSuccessfulRequests), чтобы
// нормальный пользователь с верным паролем никогда не упирался в лимит, а
// подбор пароля упирался быстро. Отдельно от этого в authController есть
// блокировка конкретной учётки по счётчику неудачных попыток.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json429
});

// Вебхук Telegram уже защищён секретным заголовком; лимит здесь — только на
// случай, если секрет утечёт, чтобы им нельзя было залить сервер. Telegram
// шлёт обновления пачками, поэтому окно короткое, а порог высокий.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).end()
});

module.exports = { apiLimiter, authLimiter, webhookLimiter };
