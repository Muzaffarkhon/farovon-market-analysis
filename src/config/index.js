const path = require('path');
require('dotenv').config({ quiet: true }); // dotenv v17 иначе печатает рекламный баннер в лог

// У секретов намеренно нет значений по умолчанию: раньше рабочий RW-токен Turso и
// ключ JWT лежали прямо в коде и попадали в историю git. Приложение должно падать
// с внятной ошибкой, а не молча работать на захардкоженном ключе.
const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || '',
  // 7 дней: короче прежних 30, но клиент продлевает сессию скользящим окном —
  // при каждом открытии приложения и раз в ~3 часа в открытой вкладке
  // /auth/resume выдаёт новый токен (см. persistToken во фронте). Переопределяется
  // переменной JWT_EXPIRES_IN, если нужно.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  dbPath: process.env.DATABASE_PATH || path.join(__dirname, '../../data/market.db'),
  tursoUrl: process.env.TURSO_DATABASE_URL || '',
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN || '',
  devDatabaseUrl: process.env.DEV_DATABASE_URL || '',
  devDatabaseAuthToken: process.env.DEV_DATABASE_AUTH_TOKEN || '',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
  webappUrl: process.env.WEBAPP_URL || 'http://localhost:3000'
};

// На Vercel окружение выставляется платформой; локально «прод» — это только
// явный NODE_ENV=production. Всё остальное считаем разработкой.
config.isProduction = !!process.env.VERCEL || config.nodeEnv === 'production';

// ── База для разработки ─────────────────────────────────────────────────────
// .env хранит боевые доступы (они же нужны офлайн-скриптам и деплою), поэтому
// локальный запуск по умолчанию бил в ПРОД: миграции и любые сохранения уходили
// в живую базу со 124 пользователями. DEV_DATABASE_URL перекрывает подключение
// вне продакшена — например file:./data/dev.db (локальный файл, сеть не нужна).
if (!config.isProduction && config.devDatabaseUrl) {
  config.tursoUrl = config.devDatabaseUrl;
  config.tursoAuthToken = config.devDatabaseAuthToken;
  config.usingDevDatabase = true;
}

/** Локальная файловая база — токен для неё не нужен и не проверяется. */
config.isFileDatabase = function isFileDatabase() {
  return /^file:/i.test(config.tursoUrl);
};

const REQUIRED_SECRETS = [
  ['JWT_SECRET', 'jwtSecret'],
  ['TURSO_DATABASE_URL', 'tursoUrl'],
  ['TURSO_AUTH_TOKEN', 'tursoAuthToken']
];

config.missingSecrets = function missingSecrets() {
  const missing = REQUIRED_SECRETS
    .filter(([envName, key]) => {
      if (envName === 'TURSO_AUTH_TOKEN' && config.isFileDatabase()) return false;
      return !config[key];
    })
    .map(([envName]) => envName);
  // Вебхук-секрет обязателен, только если бот вообще подключён: без него
  // telegramController.webhook отвечает 401 на всё, и бот молча не работает.
  if (config.telegramBotToken && !config.telegramWebhookSecret) {
    missing.push('TELEGRAM_WEBHOOK_SECRET');
  }
  return missing;
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
