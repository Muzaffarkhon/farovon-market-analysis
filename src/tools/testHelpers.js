const { createClient } = require('@libsql/client');
const { TURSO_URL_LIBSQL, TURSO_TOKEN } = require('./tursoEnv');

const client = createClient({
  url: TURSO_URL_LIBSQL,
  authToken: TURSO_TOKEN
});

async function queryAll(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows;
}

async function queryOne(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows[0] || null;
}

async function testHelpers() {
  const user = await queryOne('SELECT * FROM users WHERE LOWER(login) = LOWER(?)', ['admin']);
  console.log('queryOne test (admin):', user && user.login, 'role:', user && user.role);

  const divs = await queryAll('SELECT unit, dir FROM divisions LIMIT 3');
  console.log('queryAll test (divisions):', divs.map(d => d.unit));
}

testHelpers().catch(console.error);
