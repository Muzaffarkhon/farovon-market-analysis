const { createClient } = require('@libsql/client');
const { TURSO_URL_LIBSQL, TURSO_TOKEN } = require('./tursoEnv');

const client = createClient({
  url: TURSO_URL_LIBSQL,
  authToken: TURSO_TOKEN
});

async function test() {
  console.log('--- Testing Turso DB ---');
  const userRes = await client.execute({ sql: 'SELECT * FROM users WHERE login = ?', args: ['admin'] });
  console.log('Admin user found:', userRes.rows.length > 0 ? userRes.rows[0].login : 'NOT FOUND');

  const samadovaRes = await client.execute({ sql: 'SELECT * FROM users WHERE login = ?', args: ['samadova.f'] });
  console.log('Samadova found:', samadovaRes.rows.length > 0 ? samadovaRes.rows[0].login : 'NOT FOUND');

  const divRes = await client.execute('SELECT COUNT(*) as count FROM divisions');
  console.log('Divisions count:', divRes.rows[0].count);

  const compRes = await client.execute('SELECT COUNT(*) as count FROM competitors');
  console.log('Competitors count:', compRes.rows[0].count);
}

test().catch(console.error);
