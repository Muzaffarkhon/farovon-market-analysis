const fs = require('fs');
const path = require('path');
const { run, batch } = require('./database');

// Сидирование из src/data/seedBundle.json. Переписано под @libsql/client
// (async execute / batch) — старый вариант звал better-sqlite3 API
// (db.prepare/.transaction), которого у libsql-клиента нет, и `npm run seed`
// падал с «db.prepare is not a function».

async function runSeed() {
  console.log('🚀 Сидирование базы данных из seedBundle.json…');
  const bundlePath = path.join(__dirname, '../data/seedBundle.json');

  if (!fs.existsSync(bundlePath)) {
    console.error('❌ seedBundle.json не найден:', bundlePath);
    return;
  }

  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));

  // libsql-батч ограничен по числу операторов — режем на порции.
  const CHUNK = 200;
  async function insertMany(label, rows, sql, toArgs) {
    if (!rows || !rows.length) return;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      await batch(slice.map((r) => ({ sql, args: toArgs(r) })));
    }
    console.log(`✅ ${label}: ${rows.length}`);
  }

  // 1. Период
  if (bundle.period) {
    const p = bundle.period;
    await run(
      `INSERT OR REPLACE INTO periods (id, name, state, from_date, to_date, updated_by, is_active)
       VALUES (1, ?, ?, ?, ?, ?, 1)`,
      [
        p.name || 'Обзор рынка 2026',
        p.state || 'открыт',
        p.from_date || '2026-08-01',
        p.to_date || '2026-08-31',
        p.updated_by || 'Система'
      ]
    );
    console.log('✅ Период инициализирован');
  }

  // 2. Пользователи
  await insertMany(
    'Пользователи',
    bundle.users,
    `INSERT OR REPLACE INTO users (id, login, password_hash, fio, role, phone, units, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    (u) => [
      u.id || null,
      u.login,
      u.password_hash,
      u.fio || u.login,
      u.role || 'guest',
      u.phone || null,
      u.units || '',
      u.active !== undefined ? u.active : 1
    ]
  );

  // 3. Подразделения
  await insertMany(
    'Подразделения',
    bundle.divisions,
    `INSERT OR REPLACE INTO divisions (id, num, unit, dir, hrbp, resp)
     VALUES (?, ?, ?, ?, ?, ?)`,
    (d) => [d.id || null, d.num || 0, d.unit, d.dir || '', d.hrbp || '', d.resp || '']
  );

  // 4. Конкуренты
  await insertMany(
    'Конкуренты',
    bundle.competitors,
    `INSERT OR REPLACE INTO competitors
       (id, cid, unit, company, type, segment, region, prio, actual, note, status, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    (c) => [
      c.id || null,
      c.cid || `comp_${Math.random().toString(36).slice(2, 8)}`,
      c.unit,
      c.company,
      c.type || '',
      c.segment || '',
      c.region || '',
      c.prio || '',
      c.actual || 'уточнить',
      c.note || '',
      c.status || '',
      c.updated_by || '',
      c.updated_at || new Date().toISOString()
    ]
  );

  // 5. Справочники
  await insertMany(
    'Справочник компаний',
    bundle.dictionary_companies,
    `INSERT OR IGNORE INTO dictionary_companies (name, segment, region) VALUES (?, ?, ?)`,
    (c) => [c.name, c.segment || '', c.region || '']
  );
  await insertMany(
    'Справочник должностей',
    bundle.dictionary_positions,
    `INSERT OR IGNORE INTO dictionary_positions (name) VALUES (?)`,
    (p) => [p.name]
  );

  console.log('🎉 Сидирование завершено');
}

if (require.main === module) {
  runSeed().then(
    () => process.exit(0),
    (err) => { console.error('❌', err); process.exit(1); }
  );
}

module.exports = { runSeed };
