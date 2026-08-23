const { createClient } = require('@libsql/client');

const client = createClient({
  url: 'libsql://farovon-market-analysis-muzaffarkhon.aws-eu-west-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODc1MDIzMzYsImlkIjoiMDFhMDJlOGUtMjAwMS03MjVjLWEwNGItMGE1ZDA5MGY2NDk4Iiwia2lkIjoiTy1IeVlYU1FJYjhhV01pSk5rTUtudGpzVHpnUlBLYUdRSGFrOWlwYjZDTSIsInJpZCI6IjAyMmRjNGE0LWNhOTYtNGFhMi1hNmQ0LWFiOWM1OThhOTIwMSJ9.7tqWfPL2AuJ6WmFL3d5hhfrLYooTWE1zrCBbYfopYTkiILQ2PpSIj-8AKuxnLe-hF2fuu854zRQi-QpaIkpuDQ'
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
