const { createClient } = require('@libsql/client');
const config = require('../config');

let client = null;

function getDb() {
  if (client) return client;

  // Локальной файловой базе (DEV_DATABASE_URL=file:./data/dev.db) токен не нужен.
  if (!config.tursoUrl || (!config.tursoAuthToken && !config.isFileDatabase())) {
    throw new Error(
      'Не заданы TURSO_DATABASE_URL и/или TURSO_AUTH_TOKEN. ' +
      'На Render задайте их в Environment, локально — в файле .env (см. .env.example).'
    );
  }

  // Громкое предупреждение: разработка, подключённая к боевой базе. Именно так
  // миграции однажды уехали в прод раньше деплоя — пусть это будет видно в логе.
  if (!config.isProduction && !config.usingDevDatabase && /prod/i.test(config.tursoUrl)) {
    console.warn(
      '⚠️  ВНИМАНИЕ: локальный запуск подключён к БОЕВОЙ базе — любые сохранения и\n' +
      '   миграции уйдут в живые данные. Для разработки задайте в .env строку\n' +
      '   DEV_DATABASE_URL=file:./data/dev.db и выполните «npm run db:dev».'
    );
  }

  client = createClient({
    url: config.tursoUrl,
    authToken: config.tursoAuthToken || undefined
  });

  return client;
}

async function queryAll(sql, args = []) {
  const db = getDb();
  const res = await db.execute({ sql, args });
  return res.rows;
}

async function queryOne(sql, args = []) {
  const db = getDb();
  const res = await db.execute({ sql, args });
  return res.rows[0] || null;
}

async function run(sql, args = []) {
  const db = getDb();
  return await db.execute({ sql, args });
}

async function batch(stmts) {
  const db = getDb();
  return await db.batch(stmts, 'write');
}

module.exports = {
  getDb,
  queryAll,
  queryOne,
  run,
  batch
};
