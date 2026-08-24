// Общая точка доступа к реквизитам Turso для служебных скриптов из src/tools.
// Раньше URL и рабочий RW-токен были продублированы литералами в семи файлах —
// при ротации токена такой дубль обязательно где-нибудь останется старым.
require('dotenv').config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ Не задана переменная окружения ${name}.`);
    console.error('   Скопируйте .env.example в .env и заполните реквизиты Turso.');
    process.exit(1);
  }
  return value;
}

const TURSO_URL_LIBSQL = requireEnv('TURSO_DATABASE_URL');
const TURSO_TOKEN = requireEnv('TURSO_AUTH_TOKEN');

// libsql://host → https://host: HTTP-эндпоинт /v2/pipeline живёт по тому же адресу
const TURSO_URL_HTTP = TURSO_URL_LIBSQL.replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '');

module.exports = {
  requireEnv,
  TURSO_TOKEN,
  TURSO_URL_LIBSQL,
  TURSO_URL_HTTP,
  TURSO_URL_PIPELINE: `${TURSO_URL_HTTP}/v2/pipeline`
};
