const { createClient } = require('@libsql/client');
const config = require('../config');

let client = null;

function getDb() {
  if (client) return client;

  if (!config.tursoUrl || !config.tursoAuthToken) {
    throw new Error(
      'Не заданы TURSO_DATABASE_URL и/или TURSO_AUTH_TOKEN. ' +
      'На Render задайте их в Environment, локально — в файле .env (см. .env.example).'
    );
  }

  client = createClient({
    url: config.tursoUrl,
    authToken: config.tursoAuthToken
  });

  return client;
}

// Turso — облачная БД: единичный сетевой сбой (обрыв, таймаут рукопожатия)
// иногда роняет самый первый запрос за какое-то время, хотя соединение тут же
// восстанавливается — пользователь просто видел «Внутренняя ошибка сервера»
// на входе и всё получалось со второй попытки. Здесь один тихий повтор на
// сетевые ошибки (не на ошибки самого SQL — те повторять бессмысленно).
function isRetryableDbError(err) {
  const msg = String((err && err.message) || err || '');
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network|socket hang up/i.test(msg);
}

async function withRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!isRetryableDbError(err)) throw err;
    await new Promise((r) => setTimeout(r, 200));
    return await fn();
  }
}

async function queryAll(sql, args = []) {
  return withRetry(async () => {
    const db = getDb();
    const res = await db.execute({ sql, args });
    return res.rows;
  });
}

async function queryOne(sql, args = []) {
  return withRetry(async () => {
    const db = getDb();
    const res = await db.execute({ sql, args });
    return res.rows[0] || null;
  });
}

async function run(sql, args = []) {
  return withRetry(async () => {
    const db = getDb();
    return await db.execute({ sql, args });
  });
}

async function batch(stmts) {
  return withRetry(async () => {
    const db = getDb();
    return await db.batch(stmts, 'write');
  });
}

module.exports = {
  getDb,
  queryAll,
  queryOne,
  run,
  batch
};
