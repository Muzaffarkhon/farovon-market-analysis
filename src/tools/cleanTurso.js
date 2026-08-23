const path = require('path');
const https = require('https');
const bcrypt = require('bcryptjs');

const TURSO_URL = 'https://farovon-market-analysis-muzaffarkhon.aws-eu-west-1.turso.io/v2/pipeline';
const TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODc1MDIzMzYsImlkIjoiMDFhMDJlOGUtMjAwMS03MjVjLWEwNGItMGE1ZDA5MGY2NDk4Iiwia2lkIjoiTy1IeVlYU1FJYjhhV01pSk5rTUtudGpzVHpnUlBLYUdRSGFrOWlwYjZDTSIsInJpZCI6IjAyMmRjNGE0LWNhOTYtNGFhMi1hNmQ0LWFiOWM1OThhOTIwMSJ9.7tqWfPL2AuJ6WmFL3d5hhfrLYooTWE1zrCBbYfopYTkiILQ2PpSIj-8AKuxnLe-hF2fuu854zRQi-QpaIkpuDQ';

async function executeSql(sql, args = []) {
  const requests = [
    {
      type: 'execute',
      stmt: {
        sql,
        args: args.map(a => {
          if (a === null) return { type: 'null' };
          if (typeof a === 'number') return { type: 'integer', value: String(a) };
          return { type: 'text', value: String(a) };
        })
      }
    },
    { type: 'close' }
  ];

  const body = JSON.stringify({ requests });
  const url = new URL(TURSO_URL);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TURSO_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const execRes = parsed.results && parsed.results[0];
          if (execRes && execRes.response && execRes.response.result) {
            resolve(execRes.response.result);
          } else if (execRes && execRes.error) {
            reject(new Error(execRes.error.message));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function run() {
  console.log('1. Generating bcrypt hashes for ADMIN_PASSWORD (09630801) and CB_PASSWORD (00000000)...');
  const adminHash = bcrypt.hashSync('09630801', 10);
  const cbHash = bcrypt.hashSync('00000000', 10);

  console.log('2. Updating admin password_hash in Turso...');
  await executeSql("UPDATE users SET password_hash = ? WHERE login = 'admin';", [adminHash]);

  console.log('3. Updating cb password_hash in Turso...');
  await executeSql("UPDATE users SET password_hash = ? WHERE login = 'cb';", [cbHash]);

  console.log('4. Dropping raw_password column from users table...');
  try {
    await executeSql("ALTER TABLE users DROP COLUMN raw_password;");
    console.log('Column raw_password successfully dropped!');
  } catch (err) {
    console.log('Drop column note:', err.message);
  }

  console.log('\n5. Verifying users table schema and admin/cb users:');
  const tableInfo = await executeSql("PRAGMA table_info(users);");
  const cols = tableInfo.rows.map(r => r[1].value);
  console.log('Current columns in users:', cols.join(', '));

  const checkUsers = await executeSql("SELECT id, login, role, password_hash FROM users WHERE login IN ('admin', 'cb');");
  checkUsers.rows.forEach(r => {
    const login = r[1].value;
    const role = r[2].value;
    const hash = r[3].value;
    const isBcrypt = hash.startsWith('$2');
    console.log(`User: ${login} (${role}) | Bcrypt: ${isBcrypt} | Validates: ${bcrypt.compareSync(login === 'admin' ? '09630801' : '00000000', hash)}`);
  });
  console.log('\nALL DONE SUCCESSFULLY!');
}

run().catch(console.error);
