const path = require('path');
require('dotenv').config();

// У секретов намеренно нет значений по умолчанию: раньше рабочий RW-токен Turso и
// ключ JWT лежали прямо в коде и попадали в историю git. Приложение должно падать
// с внятной ошибкой, а не молча работать на захардкоженном ключе.
const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: '30d',
  dbPath: process.env.DATABASE_PATH || path.join(__dirname, '../../data/market.db'),
  tursoUrl: process.env.TURSO_DATABASE_URL || '',
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN || '',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  webappUrl: process.env.WEBAPP_URL || 'http://localhost:3000'
};

const REQUIRED_SECRETS = [
  ['JWT_SECRET', 'jwtSecret'],
  ['TURSO_DATABASE_URL', 'tursoUrl'],
  ['TURSO_AUTH_TOKEN', 'tursoAuthToken']
];

config.missingSecrets = function missingSecrets() {
  return REQUIRED_SECRETS.filter(([, key]) => !config[key]).map(([envName]) => envName);
};

config.assertSecrets = function assertSecrets() {
  const missing = config.missingSecrets();
  if (missing.length) {
    throw new Error(
      `Не заданы обязательные переменные окружения: ${missing.join(', ')}. ` +
      'На Render задайте их в Environment, локально — в файле .env (см. .env.example).'
    );
  }
};

module.exports = config;
