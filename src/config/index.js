const path = require('path');
require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'farovon_jwt_secret_dev_key_2026',
  jwtExpiresIn: '30d',
  dbPath: process.env.DATABASE_PATH || path.join(__dirname, '../../data/market.db'),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  webappUrl: process.env.WEBAPP_URL || 'http://localhost:3000'
};
