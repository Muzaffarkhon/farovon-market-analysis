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

// Проверка подключения к базе данных
(async () => {
  try {
    const userRes = await queryOne('SELECT COUNT(*) as count FROM users');
    console.log(`✅ Подключение к Turso LibSQL успешно. Пользователей в базе: ${userRes ? userRes.count : 0}`);
  } catch (err) {
    console.warn('⚠️ Ошибка подключения к базе данных:', err.message);
  }
  await ensureWebhook();
})();

// Middleware
app.use(cors());
app.use(helmet({
  contentSecurityPolicy: false // Для работы Telegram Mini App Web SDK
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (config.nodeEnv !== 'test') {
  app.use(morgan('dev'));
}

// Статические файлы SPA фронтенда
app.use(express.static(path.join(__dirname, '../public')));

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
  // Схему доводим до актуальной до того, как примем первый запрос. Ошибку не
  // проглатываем молча, но и сервер не роняем: без миграции работает всё, кроме
  // новых справочников, и это лучше, чем недоступное приложение у 111 человек.
  migrate().catch(err => console.error('❌ Миграция не выполнена:', err.message));

  app.listen(config.port, () => {
    console.log(`\n🚀 Сервер Farovon Market Analysis запущен: http://localhost:${config.port}`);
    console.log(`📁 База данных: ${config.dbPath}`);
    console.log(`🌐 Окружение: ${config.nodeEnv}\n`);
  });
}

module.exports = app;
