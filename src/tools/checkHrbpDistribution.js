const https = require('https');

const { TURSO_URL_PIPELINE: TURSO_URL, TURSO_TOKEN } = require('./tursoEnv');

async function query(sql) {
  const reqs = [{ type: 'execute', stmt: { sql } }, { type: 'close' }];
  const body = JSON.stringify({ requests: reqs });
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
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          const result = parsed.results[0].response.result;
          const cols = result.cols.map(c => c.name);
          const rows = result.rows.map(r => {
            const obj = {};
            r.forEach((v, i) => obj[cols[i]] = v.value !== undefined ? v.value : null);
            return obj;
          });
          resolve(rows);
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
  console.log('--- 1. HR BP in users table ---');
  const hrbpUsers = await query("SELECT id, login, fio, role, units FROM users WHERE role = 'hrbp' OR login LIKE '%hrbp%' OR fio IN (SELECT DISTINCT hrbp FROM divisions WHERE hrbp != '');");
  
  hrbpUsers.forEach((u, i) => {
    const uList = u.units ? u.units.split(';').map(s => s.trim()).filter(Boolean) : [];
    console.log(`\n[${i + 1}] HR BP: ${u.fio} (Логин: ${u.login})`);
    console.log(`    Кол-во подразделений: ${uList.length}`);
    console.log(`    Примеры подразделений: ${uList.slice(0, 4).join(' | ')}${uList.length > 4 ? ' ...' : ''}`);
  });

  console.log('\n--- 2. HR BP in divisions table ---');
  const hrbpInDivs = await query("SELECT hrbp, count(*) as div_count FROM divisions WHERE hrbp IS NOT NULL AND hrbp != '' GROUP BY hrbp ORDER BY div_count DESC;");
  console.table(hrbpInDivs);
}

run().catch(console.error);
