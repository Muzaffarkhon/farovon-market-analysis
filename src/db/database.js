const { createClient } = require('@libsql/client');
const config = require('../config');

let client = null;

function getDb() {
  if (client) return client;

  // Для локальных файловых баз данных authToken не требуется
  const isLocalFileDb = config.tursoUrl && config.tursoUrl.startsWith('file:');
  
  if (!config.tursoUrl || (!config.tursoAuthToken && !isLocalFileDb)) {
    throw new Error(
      'Не заданы TURSO_DATABASE_URL и/или TURSO_AUTH_TOKEN. ' +
      'На Render задайте их в Environment, локально — в файле .env (см. .env.example). ' +
      'Для локальной SQLite используйте TURSO_DATABASE_URL=file:./data/market.db'
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
