const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

// Автоматическая сериализация BigInt для JSON (LibSQL возвращает lastInsertRowid как BigInt)
BigInt.prototype.toJSON = function() {
  return Number(this);
};

const config = require('./config');
const { version: APP_VERSION } = require('../package.json');
const { queryOne } = require('./db/database');
const { migrate } = require('./db/migrate');
const apiRoutes = require('./routes/api');
const errorHandler = require('./middleware/errorHandler');
const { ensureWebhook } = require('./services/telegramService');

// Секретов с запасными значениями в коде больше нет — если переменные окружения не
// заданы, сервис обязан упасть сразу, а не поднять полурабочий прод.
const missing = config.missingSecrets();
if (missing.length) {
  console.error(`❌ Не заданы обязательные переменные окружения: ${missing.join(', ')}`);
  console.error('   Render → Environment (или файл .env локально, см. .env.example), затем перезапуск.');
  process.exit(1);
}

const app = express();

// За прокси Render: без этого req.ip = адрес прокси, и IP в audit_log
// бесполезны, а rate-limit считал бы всех клиентов за одного.
app.set('trust proxy', 1);

// Статус последнего прогона миграций — виден в /health, чтобы «поднялся, но
// схема не мигрировала» не оставалось незамеченным (миграция намеренно не
// блокирует старт — транзиентный сбой Turso не должен ронять весь сервис).
let migrationStatus = 'pending';

// Проверка подключения к базе данных и запуск идемпотентных миграций.
// Миграцию пробуем несколько раз с нарастающей паузой — на холодном старте
// Render соединение с Turso иногда не встаёт с первого раза.
(async () => {
  try {
    const userRes = await queryOne('SELECT COUNT(*) as count FROM users');
    console.log(`✅ Подключение к Turso LibSQL успешно. Пользователей в базе: ${userRes ? userRes.count : 0}`);
  } catch (err) {
    console.warn('⚠️ Ошибка подключения к базе данных:', err.message);
  }

  const delays = [0, 2000, 4000];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await new Promise(r => setTimeout(r, delays[attempt]));
    try {
      await migrate();
      migrationStatus = 'ok';
      console.log('✅ Идемпотентные миграции схемы базы данных успешно применены');
      break;
    } catch (err) {
      migrationStatus = 'error';
      console.warn(`⚠️ Миграция схемы (попытка ${attempt + 1}/${delays.length}) не удалась:`, err.message);
    }
  }

  await ensureWebhook();
})();

// Middleware
// CORS по белому списку вместо `cors()` (который отдавал Access-Control-Allow-Origin: *
// всем подряд). Фронтенд отдаётся тем же сервером — межсайтовые запросы к API
// делает только Telegram Mini App. Список origin'ов можно переопределить
// переменной CORS_ORIGINS (через запятую).
const corsOrigins = (process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : [config.webappUrl, 'https://web.telegram.org', 'https://farovon-market-analysis.onrender.com']
).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    // Запросы без Origin (curl, серверные, health-пинги, same-origin GET) не блокируем.
    if (!origin || corsOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  // #22 — с credentials cors отражает конкретный Origin из белого списка
  // (не `*`) и добавляет Access-Control-Allow-Credentials: true. Тогда
  // Telegram Mini App с `credentials: 'include'` может донести httpOnly-куку
  // сессии, если браузер разрешает сторонние куки; если нет — остаётся
  // запасной путь через заголовок Authorization + localStorage-токен.
  credentials: true
}));
// CSP вместо полностью выключенного. script-src/style-src оставляют
// 'unsafe-inline' — во фронте много инлайнового JS/CSS, хешировать его без
// переписывания нельзя; но внешние ресурсы, framing и base-uri теперь под
// контролем. Разрешены: сам сервер, Telegram Web SDK (telegram.org),
// Google Fonts. Встраивать страницу в iframe может только Telegram.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'", 'https://telegram.org'],
      'script-src-attr': ["'unsafe-inline'"], // во фронте ~20 инлайновых onclick=
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'self'", 'https://web.telegram.org', 'https://*.telegram.org'],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'upgrade-insecure-requests': null // ломает локальную разработку по http
    }
  },
  // X-Frame-Options: SAMEORIGIN перебил бы frame-ancestors и не пустил бы
  // Telegram-iframe. Framing контролирует CSP выше.
  frameguard: false,
  crossOriginEmbedderPolicy: false, // иначе Telegram Mini App не грузится в iframe
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(compression());

// Тело запроса: обычным роутам хватает с запасом 512 КБ. Большой JSON нужен
// только импорту опроса зарплат (весь CSV приходит строкой в теле) — для него
// отдельный парсер на 15 МБ. Так на остальные эндпоинты нельзя залить мегабайты
// мусора, заставляя сервер их буферизовать и парсить.
const jsonSmall = express.json({ limit: '512kb' });
const jsonLarge = express.json({ limit: '15mb' });
app.use((req, res, next) => {
  if (req.path === '/api/admin/import-survey') return jsonLarge(req, res, next);
  return jsonSmall(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '512kb' }));

if (config.nodeEnv !== 'test') {
  app.use(morgan('dev'));
}

// Статические файлы SPA фронтенда (с контролем кэша для мгновенного обновления версий)
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/' || req.path.endsWith('.js') || req.path.endsWith('.css')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, '../public'), { etag: false, maxAge: 0 }));

// API роуты
app.use('/api', apiRoutes);

let lastUptimeRobotPing = null;

app.use((req, res, next) => {
  const ua = req.get('user-agent');
  if (ua && ua.includes('UptimeRobot')) {
    lastUptimeRobotPing = new Date().toISOString();
  }
  next();
});

// Health check. Поле db показывает, доехало ли подключение к Turso — текст ошибки
// наружу не отдаём, он остаётся в логах Render.
app.get('/health', async (req, res) => {
  let db = 'ok';
  try {
    await queryOne('SELECT 1 AS ok');
  } catch (err) {
    db = 'error';
    console.error('❌ Health check: база недоступна:', err.message);
  }
  // ok=false и при недоступной базе, и при провалившейся миграции: с частичной
  // схемой hasCapability отдаёт «нет прав» всем не-admin — мониторинг должен
  // это видеть, а не только зелёный db-пинг.
  res.json({
    ok: db === 'ok' && migrationStatus !== 'error',
    db,
    schema: migrationStatus,
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    env: config.nodeEnv,
    lastUptimeRobotPing
  });
});

// SPA fallback для роутинга
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Обработчик ошибок
app.use(errorHandler);

// Запуск сервера
if (require.main === module) {
  // Миграции запускает IIFE выше (единственный вызов) — второй параллельный
  // прогон плодил гонки на UPDATE'ах при объединении дубликатов пользователей.

  app.listen(config.port, () => {
    console.log(`\n🚀 Сервер Farovon Market Analysis запущен: http://localhost:${config.port}`);
    console.log(`📁 База данных: ${config.dbPath}`);
    console.log(`🌐 Окружение: ${config.nodeEnv}\n`);

    // Keep-Alive пинг для предотвращения засыпания Render в рабочее время (каждые 9 мин)
    if (config.nodeEnv === 'production' || process.env.RENDER) {
      const http = require('http');
      const PING_INTERVAL = 9 * 60 * 1000;
      setInterval(() => {
        try {
          http.get(`http://127.0.0.1:${config.port}/health`, (res) => {
            res.resume();
          }).on('error', () => {});
        } catch (e) {}
      }, PING_INTERVAL).unref();
    }
  });
}

module.exports = app;
