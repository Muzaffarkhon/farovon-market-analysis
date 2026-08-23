const { createClient } = require('@libsql/client');
const config = require('../config');

let client = null;

function getDb() {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL || config.tursoUrl || 'libsql://farovon-market-analysis-muzaffarkhon.aws-eu-west-1.turso.io';
  const authToken = process.env.TURSO_AUTH_TOKEN || config.tursoAuthToken || 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODc1MDIzMzYsImlkIjoiMDFhMDJlOGUtMjAwMS03MjVjLWEwNGItMGE1ZDA5MGY2NDk4Iiwia2lkIjoiTy1IeVlYU1FJYjhhV01pSk5rTUtudGpzVHpnUlBLYUdRSGFrOWlwYjZDTSIsInJpZCI6IjAyMmRjNGE0LWNhOTYtNGFhMi1hNmQ0LWFiOWM1OThhOTIwMSJ9.7tqWfPL2AuJ6WmFL3d5hhfrLYooTWE1zrCBbYfopYTkiILQ2PpSIj-8AKuxnLe-hF2fuu854zRQi-QpaIkpuDQ';

  client = createClient({
    url,
    authToken
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
