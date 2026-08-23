const https = require('https');

const TURSO_URL = 'https://farovon-market-analysis-muzaffarkhon.aws-eu-west-1.turso.io/v2/pipeline';
const TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODc1MDIzMzYsImlkIjoiMDFhMDJlOGUtMjAwMS03MjVjLWEwNGItMGE1ZDA5MGY2NDk4Iiwia2lkIjoiTy1IeVlYU1FJYjhhV01pSk5rTUtudGpzVHpnUlBLYUdRSGFrOWlwYjZDTSIsInJpZCI6IjAyMmRjNGE0LWNhOTYtNGFhMi1hNmQ0LWFiOWM1OThhOTIwMSJ9.7tqWfPL2AuJ6WmFL3d5hhfrLYooTWE1zrCBbYfopYTkiILQ2PpSIj-8AKuxnLe-hF2fuu854zRQi-QpaIkpuDQ';

async function executeBatch(statements) {
  const requests = statements.map(s => ({
    type: 'execute',
    stmt: typeof s === 'string' ? { sql: s } : {
      sql: s.sql,
      args: s.args.map(a => {
        if (a === null || a === undefined) return { type: 'null' };
        if (typeof a === 'number') return { type: 'integer', value: String(a) };
        return { type: 'text', value: String(a) };
      })
    }
  }));
  requests.push({ type: 'close' });

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
          resolve(JSON.parse(data));
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

async function getRows(sql) {
  const res = await executeBatch([sql]);
  const execRes = res.results && res.results[0];
  if (execRes && execRes.response && execRes.response.result) {
    const result = execRes.response.result;
    const cols = result.cols.map(c => c.name);
    return result.rows.map(r => {
      const obj = {};
      r.forEach((val, i) => {
        obj[cols[i]] = val.value !== undefined ? val.value : null;
      });
      return obj;
    });
  }
  return [];
}

async function run() {
  console.log('1. Fetching all users and their assigned units...');
  const users = await getRows("SELECT id, login, fio, role, units FROM users WHERE units IS NOT NULL AND units != '' AND role NOT IN ('admin', 'cb');");
  console.log(`Found ${users.length} users with assigned units.`);

  const unitToUsersMap = {};
  users.forEach(u => {
    const unitList = u.units.split(';').map(s => s.trim()).filter(Boolean);
    unitList.forEach(unitName => {
      if (!unitToUsersMap[unitName]) unitToUsersMap[unitName] = [];
      if (!unitToUsersMap[unitName].includes(u.fio)) {
        unitToUsersMap[unitName].push(u.fio);
      }
    });
  });

  const distinctUnits = Object.keys(unitToUsersMap);
  console.log(`Distinct units mapped: ${distinctUnits.length}`);

  const stmts = [];
  distinctUnits.forEach(unitName => {
    const respString = unitToUsersMap[unitName].join(', ');
    stmts.push({
      sql: "UPDATE divisions SET resp = ? WHERE unit = ?;",
      args: [respString, unitName]
    });
    stmts.push({
      sql: "UPDATE competitors SET resp = ? WHERE unit = ?;",
      args: [respString, unitName]
    });
  });

  console.log(`Executing ${stmts.length} updates in batches...`);
  const chunkSize = 50;
  for (let i = 0; i < stmts.length; i += chunkSize) {
    const chunk = stmts.slice(i, i + chunkSize);
    await executeBatch(chunk);
    console.log(`Updated batch ${Math.floor(i / chunkSize) + 1}/${Math.ceil(stmts.length / chunkSize)}`);
  }

  console.log('\n🎉 ALL UPDATES COMPLETED!');
  const pravlenie = await getRows("SELECT unit, dir, head, resp, hrbp FROM divisions WHERE unit = 'Правление';");
  console.log('\nDivision "Правление" in Turso now:');
  console.log(pravlenie);
}

run().catch(console.error);
