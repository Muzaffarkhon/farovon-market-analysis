const { createClient } = require('@libsql/client');

const client = createClient({
  url: 'libsql://farovon-market-analysis-muzaffarkhon.aws-eu-west-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODc1MDIzMzYsImlkIjoiMDFhMDJlOGUtMjAwMS03MjVjLWEwNGItMGE1ZDA5MGY2NDk4Iiwia2lkIjoiTy1IeVlYU1FJYjhhV01pSk5rTUtudGpzVHpnUlBLYUdRSGFrOWlwYjZDTSIsInJpZCI6IjAyMmRjNGE0LWNhOTYtNGFhMi1hNmQ0LWFiOWM1OThhOTIwMSJ9.7tqWfPL2AuJ6WmFL3d5hhfrLYooTWE1zrCBbYfopYTkiILQ2PpSIj-8AKuxnLe-hF2fuu854zRQi-QpaIkpuDQ'
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
