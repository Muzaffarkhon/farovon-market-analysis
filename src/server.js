const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const config = require('./config');
const { queryOne } = require('./db/database');
const apiRoutes = require('./routes/api');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Проверка подключения к базе данных
(async () => {
  try {
    const userRes = await queryOne('SELECT COUNT(*) as count FROM users');
    console.log(`✅ Подключение к Turso LibSQL успешно. Пользователей в базе: ${userRes ? userRes.count : 0}`);
  } catch (err) {
    console.warn('⚠️ Ошибка подключения к базе данных:', err.message);
  }
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

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    ok: true, 
    version: '2.1.4', 
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
  app.listen(config.port, () => {
    console.log(`\n🚀 Сервер Farovon Market Analysis запущен: http://localhost:${config.port}`);
    console.log(`📁 База данных: ${config.dbPath}`);
    console.log(`🌐 Окружение: ${config.nodeEnv}\n`);
  });
}

module.exports = app;
