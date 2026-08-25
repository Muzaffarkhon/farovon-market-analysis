const fs = require('fs');
const path = require('path');
const { getDb } = require('./database');

async function runSeed() {
  console.log('🚀 Начинаем сидирование базы данных из seedBundle.json...');
  const db = getDb();
  const bundlePath = path.join(__dirname, '../data/seedBundle.json');

  if (!fs.existsSync(bundlePath)) {
    console.error('❌ seedBundle.json не найден');
    return;
  }

  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));

  // 1. Период
  if (bundle.period) {
    const p = bundle.period;
    await db.execute({
      sql: `INSERT OR REPLACE INTO periods (id, name, state, from_date, to_date, updated_by) VALUES (1, ?, ?, ?, ?, ?)`,
      args: [p.name || 'Обзор рынка 2026', p.state || 'открыт', p.from_date || '2026-08-01', p.to_date || '2026-08-31', p.updated_by || 'Система']
    });
    console.log('✅ Период инициализирован');
  }

  // 2. Пользователи
  if (bundle.users && bundle.users.length) {
    for (const u of bundle.users) {
      await db.execute({
        sql: `INSERT OR REPLACE INTO users (id, login, password_hash, fio, role, phone, units, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [u.id || null, u.login, u.password_hash, u.fio || u.login, u.role || 'guest', u.phone || null, u.units || '', u.active !== undefined ? u.active : 1]
      });
    }
    console.log(`✅ Пользователи (${bundle.users.length}) сидированы`);
  }

  // 3. Подразделения
  if (bundle.divisions && bundle.divisions.length) {
    for (const d of bundle.divisions) {
      await db.execute({
        sql: `INSERT OR REPLACE INTO divisions (id, num, unit, dir, hrbp, resp) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [d.id || null, d.num || 0, d.unit, d.dir || '', d.hrbp || '', d.resp || '']
      });
    }
    console.log(`✅ Подразделения (${bundle.divisions.length}) сидированы`);
  }

  // 4. Конкуренты
  if (bundle.competitors && bundle.competitors.length) {
    for (const c of bundle.competitors) {
      await db.execute({
        sql: `INSERT OR REPLACE INTO competitors (id, cid, unit, company, type, segment, region, prio, actual, note, status, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [c.id || null, c.cid || `comp_${Math.random().toString(36).slice(2, 8)}`, c.unit, c.company, c.type || '', c.segment || '', c.region || '', c.prio || '', c.actual || 'уточнить', c.note || '', c.status || '', c.updated_by || '', c.updated_at || new Date().toISOString()]
      });
    }
    console.log(`✅ Конкуренты (${bundle.competitors.length}) сидированы`);
  }

  // 5. Справочники
  if (bundle.dictionary_companies && bundle.dictionary_companies.length) {
    for (const c of bundle.dictionary_companies) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO dictionary_companies (name, segment, region) VALUES (?, ?, ?)`,
        args: [c.name, c.segment || '', c.region || '']
      });
    }
  }

  if (bundle.dictionary_positions && bundle.dictionary_positions.length) {
    for (const p of bundle.dictionary_positions) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO dictionary_positions (name) VALUES (?)`,
        args: [p.name]
      });
    }
  }

  console.log('🎉 Сидирование успешно завершено!');
}

if (require.main === module) {
  runSeed().catch(console.error);
}

module.exports = {
  runSeed
};
