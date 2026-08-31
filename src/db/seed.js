const fs = require('fs');
const path = require('path');
const { getDb } = require('./database');

function runSeed() {
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
    db.prepare(`
      INSERT OR REPLACE INTO periods (id, name, state, from_date, to_date, updated_by)
      VALUES (1, ?, ?, ?, ?, ?)
    `).run(p.name || 'Обзор рынка 2026', p.state || 'открыт', p.from_date || '2026-08-01', p.to_date || '2026-08-31', p.updated_by || 'Система');
    console.log('✅ Период инициализирован');
  }

  // 2. Пользователи
  if (bundle.users && bundle.users.length) {
    const insertUser = db.prepare(`
      INSERT OR REPLACE INTO users (id, login, password_hash, fio, role, phone, units, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertManyUsers = db.transaction((users) => {
      for (const u of users) {
        insertUser.run(
          u.id || null,
          u.login,
          u.password_hash,
          u.fio || u.login,
          u.role || 'guest',
          u.phone || null,
          u.units || '',
          u.active !== undefined ? u.active : 1
        );
      }
    });
    insertManyUsers(bundle.users);
    console.log(`✅ Пользователи (${bundle.users.length}) сидированы`);
  }

  // 3. Подразделения
  if (bundle.divisions && bundle.divisions.length) {
    const insertDiv = db.prepare(`
      INSERT OR REPLACE INTO divisions (id, num, unit, dir, hrbp, resp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertManyDivs = db.transaction((divs) => {
      for (const d of divs) {
        insertDiv.run(
          d.id || null,
          d.num || 0,
          d.unit,
          d.dir || '',
          d.hrbp || '',
          d.resp || ''
        );
      }
    });
    insertManyDivs(bundle.divisions);
    console.log(`✅ Подразделения (${bundle.divisions.length}) сидированы`);
  }

  // 4. Конкуренты
  if (bundle.competitors && bundle.competitors.length) {
    const insertComp = db.prepare(`
      INSERT OR REPLACE INTO competitors (id, cid, unit, company, type, segment, region, prio, actual, note, status, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertManyComps = db.transaction((comps) => {
      for (const c of comps) {
        insertComp.run(
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
        );
      }
    });
    insertManyComps(bundle.competitors);
    console.log(`✅ Конкуренты (${bundle.competitors.length}) сидированы`);
  }

  // 5. Справочники
  if (bundle.dictionary_companies && bundle.dictionary_companies.length) {
    const insertDictComp = db.prepare(`
      INSERT OR IGNORE INTO dictionary_companies (name, segment, region)
      VALUES (?, ?, ?)
    `);
    const insertManyDict = db.transaction((comps) => {
      for (const c of comps) {
        insertDictComp.run(c.name, c.segment || '', c.region || '');
      }
    });
    insertManyDict(bundle.dictionary_companies);
  }

  if (bundle.dictionary_positions && bundle.dictionary_positions.length) {
    const insertDictPos = db.prepare(`
      INSERT OR IGNORE INTO dictionary_positions (name)
      VALUES (?)
    `);
    const insertManyPositions = db.transaction((positions) => {
      for (const p of positions) {
        insertDictPos.run(p.name);
      }
    });
    insertManyPositions(bundle.dictionary_positions);
  }

  console.log('🎉 Сидирование успешно завершено!');
}

if (require.main === module) {
  runSeed();
}

module.exports = {
  runSeed
};
