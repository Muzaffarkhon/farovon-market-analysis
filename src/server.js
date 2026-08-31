const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const config = require('./config');
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

// Проверка подключения к базе данных и запуск идемпотентных миграций
(async () => {
  try {
    const userRes = await queryOne('SELECT COUNT(*) as count FROM users');
    console.log(`✅ Подключение к Turso LibSQL успешно. Пользователей в базе: ${userRes ? userRes.count : 0}`);
    await migrate();
    console.log('✅ Идемпотентные миграции схемы базы данных успешно применены');
  } catch (err) {
    console.warn('⚠️ Ошибка подключения/миграции базы данных:', err.message);
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
  credentials: false
}));
app.use(helmet({
  contentSecurityPolicy: false // Для работы Telegram Mini App Web SDK
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
  res.json({ 
    ok: db === 'ok', 
    db, 
    version: '2.2.0', 
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
