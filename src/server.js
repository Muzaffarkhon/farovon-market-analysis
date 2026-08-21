const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const config = require('./config');
const { getDb } = require('./db/database');
const { runSeed } = require('./db/seed');
const apiRoutes = require('./routes/api');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Инициализация базы данных и сидирование при первом запуске
try {
  const db = getDb();
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    console.log('📦 База данных пуста. Запускаем автоматическое сидирование...');
    runSeed();
  }
} catch (err) {
  console.warn('⚠️ Ошибка при автоматической проверке сидов:', err.message);
}

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

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString(), env: config.nodeEnv });
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
