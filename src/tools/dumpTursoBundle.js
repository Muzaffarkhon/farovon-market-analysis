const fs = require('fs');
const path = require('path');

const TURSO_URL = 'https://farovon-market-analysis-muzaffarkhon.aws-eu-west-1.turso.io';
const TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODc1MDIzMzYsImlkIjoiMDFhMDJlOGUtMjAwMS03MjVjLWEwNGItMGE1ZDA5MGY2NDk4Iiwia2lkIjoiTy1IeVlYU1FJYjhhV01pSk5rTUtudGpzVHpnUlBLYUdRSGFrOWlwYjZDTSIsInJpZCI6IjAyMmRjNGE0LWNhOTYtNGFhMi1hNmQ0LWFiOWM1OThhOTIwMSJ9.7tqWfPL2AuJ6WmFL3d5hhfrLYooTWE1zrCBbYfopYTkiILQ2PpSIj-8AKuxnLe-hF2fuu854zRQi-QpaIkpuDQ';

async function tursoQuery(sql, args = []) {
  const res = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TURSO_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [
        {
          type: 'execute',
          stmt: {
            sql,
            args: args.map(a => {
              if (a === null || a === undefined) return { type: 'null' };
              if (typeof a === 'number') return { type: 'integer', value: String(a) };
              return { type: 'text', value: String(a) };
            })
          }
        },
        { type: 'close' }
      ]
    })
  });
  const data = await res.json();
  const execRes = data.results && data.results[0];
  if (execRes && execRes.response && execRes.response.result) {
    const cols = execRes.response.result.cols.map(c => c.name);
    const rows = execRes.response.result.rows.map(r => {
      const obj = {};
      r.forEach((val, idx) => {
        obj[cols[idx]] = val.value !== undefined ? val.value : null;
      });
      return obj;
    });
    return rows;
  }
  return [];
}

async function dumpTursoToSeedBundle() {
  console.log('🔄 Загружаем полные данные из Turso Cloud DB...');

  const users = await tursoQuery('SELECT * FROM users ORDER BY id ASC');
  const divisions = await tursoQuery('SELECT * FROM divisions ORDER BY num ASC, unit ASC');
  const competitors = await tursoQuery('SELECT * FROM competitors ORDER BY id ASC');
  const surveys = await tursoQuery('SELECT * FROM surveys ORDER BY id ASC');
  const periods = await tursoQuery('SELECT * FROM periods ORDER BY id DESC LIMIT 1');
  const dictCompanies = await tursoQuery('SELECT * FROM dictionary_companies ORDER BY name ASC');
  const dictPositions = await tursoQuery('SELECT * FROM dictionary_positions ORDER BY name ASC');

  console.log(`✅ Получено: ${users.length} пользователей, ${divisions.length} подразделений, ${competitors.length} конкурентов, ${surveys.length} анкет.`);

  const bundle = {
    version: '2.1.0',
    generated_at: new Date().toISOString(),
    period: periods[0] || { name: 'Обзор рынка 2026', state: 'открыт', from_date: '2026-08-01', to_date: '2026-08-31', updated_by: 'Система' },
    users,
    divisions,
    competitors,
    surveys,
    dictionary_companies: dictCompanies,
    dictionary_positions: dictPositions
  };

  const bundlePath = path.join(__dirname, '../data/seedBundle.json');
  fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), 'utf8');
  console.log(`💾 seedBundle.json сохранён (${bundlePath})`);
}

dumpTursoToSeedBundle().catch(console.error);
