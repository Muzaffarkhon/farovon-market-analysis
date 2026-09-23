const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

// Автоматическая сериализация BigInt для JSON (LibSQL возвращает lastInsertRowid как BigInt)
BigInt.prototype.toJSON = function() {
  return Number(this);
};

const config = require('./config');

function getAppVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    return pkg.version || '2.5.0';
  } catch (e) {
    return '2.5.0';
  }
}
const APP_VERSION = getAppVersion();
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
  console.error('   Vercel → Settings → Environment Variables (или файл .env локально, см. .env.example), затем редеплой.');
  process.exit(1);
}

const app = express();

// За прокси Render: без этого req.ip = адрес прокси, и IP в audit_log
// бесполезны, а rate-limit считал бы всех клиентов за одного.
app.set('trust proxy', 1);

// Ленивая инициализация для serverless (Vercel): один раз на инстанс функции,
// не блокируя запрос. При локальном запуске дублируется явным вызовом ниже —
// повторный вызов безвреден (ensureBootstrapped идемпотентен).
app.use((req, res, next) => {
  ensureBootstrapped();
  next();
});

// Статус последнего прогона миграций — виден в /health, чтобы «поднялся, но
// схема не мигрировала» не оставалось незамеченным (миграция намеренно не
// блокирует старт — транзиентный сбой Turso не должен ронять весь сервис).
let migrationStatus = 'pending';

// Первичная инициализация: проверка БД, идемпотентные миграции схемы, регистрация
// Telegram-вебхука. На Render это выполнялось один раз при старте долгоживущего
// процесса. На Vercel процесса-долгожителя нет: основной прогон миграций делает
// `npm run vercel-build` (src/db/migrateCli.js) при каждом деплое, а bootstrap()
// здесь — подстраховка, срабатывающая один раз на инстанс serverless-функции
// (см. ensureBootstrapped ниже) на случай, если сборочный прогон был пропущен
// или не удался.
async function bootstrap() {
  try {
    const userRes = await queryOne('SELECT COUNT(*) as count FROM users');
    // Пишем РЕАЛЬНЫЙ адрес базы: раньше в логе всегда стояло «Turso» и
    // config.dbPath, из-за чего локальный запуск на боевой базе выглядел
    // ровно так же, как на тестовой.
    console.log(`✅ База подключена: ${config.tursoUrl}. Пользователей: ${userRes ? userRes.count : 0}`);
  } catch (err) {
    console.warn('⚠️ Ошибка подключения к базе данных:', err.message);
  }

  // Миграцию пробуем несколько раз с нарастающей паузой — на холодном старте
  // соединение с Turso иногда не встаёт с первого раза.
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
}

// Единственный запуск bootstrap() на процесс/инстанс. На Vercel вызывается лениво
// из middleware (fire-and-forget — первый запрос не тормозится: миграции уже
// прогнаны на этапе сборки); при локальном запуске — явно перед app.listen.
let bootstrapPromise = null;
function ensureBootstrapped() {
  if (!bootstrapPromise) bootstrapPromise = bootstrap().catch(() => {});
  return bootstrapPromise;
}

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
// контролем. Разрешён единственный внешний ресурс — Telegram Web SDK
// (telegram.org). Шрифты системные (см. index.html), внешних font/style нет.
// Встраивать страницу в iframe может только Telegram.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'", 'https://telegram.org'],
      'script-src-attr': ["'unsafe-inline'"], // во фронте ~20 инлайновых onclick=
      'style-src': ["'self'", "'unsafe-inline'"],
      'font-src': ["'self'", 'data:'],
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
  if (req.path === '/api/admin/import-survey' || req.path === '/api/benchmarks/import/xlsx-sheets' ||
      req.path === '/api/benchmarks/import/xlsx-grid') return jsonLarge(req, res, next);
  return jsonSmall(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '512kb' }));

if (config.nodeEnv !== 'test') {
  app.use(morgan('dev'));
}

function renderIndexHtml() {
  const indexPath = path.join(__dirname, '../client/index.html');
  if (!fs.existsSync(indexPath)) return '<h1>File not found</h1>';
  let html = fs.readFileSync(indexPath, 'utf8');
  const ver = getAppVersion();
  // Кэш-бастинг query-параметров на всех ссылках и скриптах
  html = html.replace(/\?v=[a-zA-Z0-9._-]+/g, `?v=${ver}`);
  // Глобальная переменная window.APP_VERSION в теге head
  const verClean = 'v' + ver.replace(/^v/, '');
  const injectScript = `<script>window.APP_VERSION = '${verClean}';</script>\n</head>`;
  if (html.includes('</head>') && !html.includes('window.APP_VERSION')) {
    html = html.replace('</head>', injectScript);
  }
  return html;
}

// Динамический Service Worker со свежим именем кэша
app.get('/sw.js', (req, res) => {
  const swPath = path.join(__dirname, '../client/sw.js');
  if (!fs.existsSync(swPath)) return res.status(404).end();
  let content = fs.readFileSync(swPath, 'utf8');
  const safeVer = getAppVersion().replace(/[^a-zA-Z0-9]/g, '-');
  content = content.replace(/const CACHE_NAME = ['"]farovon-market-v[^'"]+['"];/, `const CACHE_NAME = 'farovon-market-v${safeVer}';`);
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(content);
});

// Новый клиент (web/ → client/next). Живёт рядом со старым на /new, пока не
// закроет всю функциональность; сессия общая (тот же cookie). index.html без
// кеша, ассеты с хешами в имени — на год.
const NEXT_DIR = path.join(__dirname, '../client/next');
app.use('/new', express.static(NEXT_DIR, { index: false, etag: true, maxAge: '1y', immutable: true }));
app.get(['/new', '/new/*splat'], (req, res, next) => {
  const indexPath = path.join(NEXT_DIR, 'index.html');
  if (!fs.existsSync(indexPath)) return next();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(indexPath);
});

// Главная страница с динамической версией и защитой от кэширования
app.get(['/', '/index.html'], (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(renderIndexHtml());
});

// Статические файлы SPA фронтенда (с контролем кэша для мгновенного обновления версий)
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/' || req.path.endsWith('.js') || req.path.endsWith('.css')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, '../client'), { etag: false, maxAge: 0 }));

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
    version: getAppVersion(),
    timestamp: new Date().toISOString(),
    env: config.nodeEnv,
    lastUptimeRobotPing
  });
});

// SPA fallback для роутинга (Express 5: безымянный '*' больше не поддерживается
// path-to-regexp — нужен именованный wildcard)
app.get('/*splat', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(renderIndexHtml());
});

// Обработчик ошибок
app.use(errorHandler);

// Запуск сервера
if (require.main === module) {
  // Единственный прогон миграций — параллельный второй плодил гонки на
  // UPDATE'ах при объединении дубликатов пользователей.
  ensureBootstrapped();

  app.listen(config.port, () => {
    console.log(`\n🚀 Сервер Farovon Market Analysis запущен: http://localhost:${config.port}`);
    console.log(`📁 База данных: ${config.tursoUrl}`);
    console.log(`🌐 Окружение: ${config.nodeEnv}\n`);
  });
}

app.getAppVersion = getAppVersion;

module.exports = app;
