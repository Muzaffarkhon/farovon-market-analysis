const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb } = require('./database');

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(String(pwd || '')).digest('hex');
}

// Простой парсер CSV с поддержкой кавычек и переносов
function parseCsv(content) {
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    const next = content[i + 1];

    if (c === '"') {
      if (inQuotes && next === '"') {
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      currentRow.push(currentVal);
      currentVal = '';
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') i++;
      currentRow.push(currentVal);
      if (currentRow.length > 0 && currentRow.some(x => x.trim() !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentVal = '';
    } else {
      currentVal += c;
    }
  }

  if (currentVal !== '' || currentRow.length > 0) {
    currentRow.push(currentVal);
    if (currentRow.some(x => x.trim() !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function runSeed() {
  console.log('🚀 Начинаем сидирование базы данных SQLite...');
  const db = getDb();
  const dataDir = path.join(__dirname, '../../data');

  // 1. Сидирование периодов
  const periodStmt = db.prepare(`
    INSERT OR IGNORE INTO periods (name, state, from_date, to_date, updated_by)
    VALUES (?, ?, ?, ?, ?)
  `);
  periodStmt.run('Обзор рынка 2026', 'открыт', '2026-08-01', '2026-08-31', 'Система');
  console.log('✅ Период сбора данных инициализирован');

  // 2. Сидирование пользователей
  const userFile = path.join(dataDir, '(Свод данных) Конкуренты по подразделениям ОБЩИЙ - Пользователи.csv');
  const pwdFile = path.join(dataDir, '(Свод данных) Конкуренты по подразделениям ОБЩИЙ - Пароли (выдать).csv');

  const pwdMap = {};
  const phoneMap = {};
  if (fs.existsSync(pwdFile)) {
    const pwdRows = parseCsv(fs.readFileSync(pwdFile, 'utf8'));
    for (let i = 1; i < pwdRows.length; i++) {
      const r = pwdRows[i];
      const log = (r[2] || '').trim().toLowerCase();
      if (log) {
        pwdMap[log] = (r[3] || '').trim();
        phoneMap[log] = (r[4] || '').trim();
      }
    }
  }

  if (fs.existsSync(userFile)) {
    const uRows = parseCsv(fs.readFileSync(userFile, 'utf8'));
    const insertUser = db.prepare(`
      INSERT OR REPLACE INTO users (login, password_hash, raw_password, fio, role, phone, units, active, last_login_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (let i = 1; i < uRows.length; i++) {
        const r = uRows[i];
        const login = (r[0] || '').trim();
        if (!login) continue;
        const norm = login.toLowerCase();
        const hash = (r[1] || '').trim() || hashPassword(pwdMap[norm] || '123456');
        const fio = (r[2] || '').trim() || login;
        const role = (r[3] || 'user').trim().toLowerCase();
        const units = (r[4] || '').trim();
        const active = (r[5] || 'да').trim().toLowerCase() === 'да' ? 1 : 0;
        const lastIn = (r[6] || '').trim();

        insertUser.run(
          login,
          hash,
          pwdMap[norm] || null,
          fio,
          role,
          phoneMap[norm] || null,
          units,
          active,
          lastIn || null
        );
      }

      // Добавим супер-администратора по умолчанию, если нет
      const adminExists = db.prepare('SELECT id FROM users WHERE login = ?').get('admin');
      if (!adminExists) {
        insertUser.run('admin', hashPassword('admin123'), 'admin123', 'Администратор C&B', 'admin', null, '', 1, null);
      }
    })();
    console.log('✅ Пользователи успешно импортированы');
  }

  // 3. Сидирование подразделений (326 подразделений)
  const divFile = path.join(dataDir, '(Свод данных) Конкуренты по подразделениям ОБЩИЙ - Подразделения.csv');
  if (fs.existsSync(divFile)) {
    const divRows = parseCsv(fs.readFileSync(divFile, 'utf8'));
    const insertDiv = db.prepare(`
      INSERT OR REPLACE INTO divisions (num, dir, unit, level, head, resp, hrbp, cnt, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (let i = 1; i < divRows.length; i++) {
        const r = divRows[i];
        const num = parseInt(r[0] || '0', 10) || i;
        const dir = (r[2] || '').trim();
        const unit = (r[4] || '').trim();
        if (!unit) continue;
        const level = (r[5] || '').trim();
        const head = (r[7] || '').trim();
        const resp = (r[9] || '').trim();
        const hrbp = (r[11] || '').trim();
        const cnt = parseInt(r[12] || '0', 10) || 0;
        const note = (r[13] || '').trim();

        insertDiv.run(num, dir, unit, level, head, resp, hrbp, cnt, note);
      }
    })();
    console.log('✅ Оргструктура (326 подразделений) успешно импортирована');
  }

  // 4. Сидирование конкурентов
  const compFile = path.join(dataDir, '(Свод данных) Конкуренты по подразделениям ОБЩИЙ - Конкуренты.csv');
  if (fs.existsSync(compFile)) {
    const compRows = parseCsv(fs.readFileSync(compFile, 'utf8'));
    const insertComp = db.prepare(`
      INSERT OR REPLACE INTO competitors (cid, num, dir, unit, resp, hrbp, company, type, segment, region, prio, status, src, note, actual, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (let i = 1; i < compRows.length; i++) {
        const r = compRows[i];
        const num = parseInt(r[0] || '0', 10) || i;
        const dir = (r[1] || '').trim();
        const unit = (r[2] || '').trim();
        const resp = (r[3] || '').trim();
        const hrbp = (r[4] || '').trim();
        const company = (r[5] || '').trim();
        if (!unit || !company) continue;

        const type = (r[6] || '').trim();
        const segment = (r[7] || '').trim();
        const region = (r[8] || '').trim();
        const prio = (r[9] || '').trim();
        const status = (r[10] || '').trim();
        const src = (r[11] || '').trim();
        const note = (r[12] || '').trim();
        const actual = (r[13] || 'уточнить').trim();
        const updatedBy = (r[14] || '').trim();
        const updatedAt = (r[15] || '').trim();
        const cid = (r[16] || '').trim() || ('c_' + num + '_' + Math.random().toString(36).slice(2, 7));

        insertComp.run(cid, num, dir, unit, resp, hrbp, company, type, segment, region, prio, status, src, note, actual, updatedBy, updatedAt || null);
      }
    })();
    console.log('✅ Связи компаний-конкурентов успешно импортированы');
  }

  // 5. Сидирование справочника компаний
  const dictFile = path.join(dataDir, '(Свод данных) Конкуренты по подразделениям ОБЩИЙ - Справочник.csv');
  if (fs.existsSync(dictFile)) {
    const dictRows = parseCsv(fs.readFileSync(dictFile, 'utf8'));
    const insertDict = db.prepare(`
      INSERT OR IGNORE INTO dictionary_companies (name, segment, region)
      VALUES (?, ?, ?)
    `);

    db.transaction(() => {
      for (let i = 1; i < dictRows.length; i++) {
        const r = dictRows[i];
        const name = (r[0] || '').trim();
        if (!name) continue;
        const segment = (r[1] || '').trim();
        const region = (r[2] || '').trim();
        insertDict.run(name, segment, region);
      }
    })();
    console.log('✅ Справочник компаний успешно импортирован');
  }

  // 6. Аудит-лог
  db.prepare(`
    INSERT INTO audit_log (login, action, detail)
    VALUES (?, ?, ?)
  `).run('system', 'миграция БД', 'База данных успешно инициализирована из исходных CSV');

  console.log('🎉 Сидирование завершено успешно!');
}

if (require.main === module) {
  runSeed();
}

module.exports = {
  runSeed
};
