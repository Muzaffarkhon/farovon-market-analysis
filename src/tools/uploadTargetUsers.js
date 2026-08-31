const fs = require('fs');
const path = require('path');
const https = require('https');
const bcrypt = require('bcryptjs');

const { TURSO_URL_PIPELINE: TURSO_URL, TURSO_TOKEN } = require('./tursoEnv');

const targetTxtPath = 'C:\\Users\\Acer\\OneDrive\\Desktop\\данные\\Пользователи - руководители, HR BP, C&B.txt';
const exportPath = 'C:\\Users\\Acer\\OneDrive\\Desktop\\данные\\Доступы_пользователей_для_выдачи.csv';
const dataDir = path.join(__dirname, '../../data');

async function executeSql(sql, args = []) {
  const requests = [
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

async function getRows(sql) {
  const requests = [{ type: 'execute', stmt: { sql } }, { type: 'close' }];
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
            const result = execRes.response.result;
            const cols = result.cols.map(c => c.name);
            const rows = result.rows.map(r => {
              const obj = {};
              r.forEach((val, i) => {
                obj[cols[i]] = val.value !== undefined ? val.value : null;
              });
              return obj;
            });
            resolve(rows);
          } else {
            resolve([]);
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

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim() !== '');
  return lines.map(line => {
    const res = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (c === ',' && !inQuotes) {
        res.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    res.push(cur);
    return res;
  });
}

function cleanWord(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[ъь]/g, '')
    .replace(/[ӣī]/g, 'и')
    .replace(/[ӯū]/g, 'у')
    .replace(/[ҳh]/g, 'х')
    .replace(/[ҷj]/g, 'ч')
    .replace(/[қq]/g, 'к')
    .replace(/[ёe]/g, 'е')
    .replace(/[^a-zа-я0-9]/g, '');
}

function wordsMatch(targetName, fullName) {
  const tWords = targetName.split(/[\s,]+/).map(cleanWord).filter(w => w.length >= 3);
  const fWords = fullName.split(/[\s,]+/).map(cleanWord).filter(w => w.length >= 3);
  if (tWords.length === 0 || fWords.length === 0) return false;
  const matched = tWords.filter(tw => fWords.some(fw => fw.startsWith(tw) || tw.startsWith(fw) || fw.includes(tw) || tw.includes(fw)));
  return matched.length >= Math.min(2, tWords.length);
}

async function uploadTargetUsers() {
  console.log('1. Reading target users list...');
  const targetLines = fs.readFileSync(targetTxtPath, 'utf8')
    .split(/\r?\n/)
    .map(l => l.replace(/^\d+\.\s*/, '').trim())
    .filter(l => l.length > 2);

  const currentTursoUsers = await getRows("SELECT id, login, fio, role, units FROM users;");
  console.log(`Current users in Turso: ${currentTursoUsers.length}`);

  const userFile = path.join(dataDir, '(Свод данных) Конкуренты по подразделениям ОБЩИЙ - Пользователи.csv');
  const pwdFile = path.join(dataDir, '(Свод данных) Конкуренты по подразделениям ОБЩИЙ - Пароли (выдать).csv');

  const pwdMap = {};
  const phoneMap = {};
  if (fs.existsSync(pwdFile)) {
    const pRows = parseCsv(fs.readFileSync(pwdFile, 'utf8'));
    for (let i = 1; i < pRows.length; i++) {
      const r = pRows[i];
      const log = (r[2] || '').trim().toLowerCase();
      if (log) {
        pwdMap[log] = (r[3] || '').trim();
        phoneMap[log] = (r[4] || '').trim();
      }
    }
  }

  const allCsvUsers = [];
  if (fs.existsSync(userFile)) {
    const uRows = parseCsv(fs.readFileSync(userFile, 'utf8'));
    for (let i = 1; i < uRows.length; i++) {
      const r = uRows[i];
      const login = (r[0] || '').trim();
      if (!login) continue;
      const fio = (r[2] || '').trim();
      const role = (r[3] || 'user').trim();
      const units = (r[4] || '').trim();
      const norm = login.toLowerCase();
      allCsvUsers.push({
        login,
        fio,
        role,
        units,
        password: pwdMap[norm] || '123456',
        phone: phoneMap[norm] || ''
      });
    }
  }

  const exportRows = [
    ['№', 'ФИО (из списка)', 'ФИО в системе', 'Логин', 'Пароль', 'Роль', 'Подразделения', 'Статус в Turso']
  ];

  const usedLogins = new Set(currentTursoUsers.map(u => (u.login || '').toLowerCase()));
  let insertedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < targetLines.length; i++) {
    const name = targetLines[i];
    const num = i + 1;

    // Check if in Turso
    const inTurso = currentTursoUsers.find(u => wordsMatch(name, u.fio) || wordsMatch(name, u.login));
    if (inTurso) {
      skippedCount++;
      const normLog = (inTurso.login || '').toLowerCase();
      const rawPwd = pwdMap[normLog] || '(уже задан)';
      exportRows.push([
        num,
        `"${name}"`,
        `"${inTurso.fio}"`,
        `"${inTurso.login}"`,
        `"${rawPwd}"`,
        `"${inTurso.role}"`,
        `"${inTurso.units || ''}"`,
        '"Уже был в Turso"'
      ]);
      continue;
    }

    // Match special or CSV
    let userToAdd = null;
    if (name === 'Акмалхоча Урунов') {
      userToAdd = allCsvUsers.find(u => u.login === 'urunov.aa');
    }
    if (!userToAdd) {
      userToAdd = allCsvUsers.find(u => !usedLogins.has(u.login.toLowerCase()) && (wordsMatch(name, u.fio) || wordsMatch(name, u.login)));
    }
    if (!userToAdd) {
      userToAdd = {
        login: 'user_' + num,
        fio: name,
        role: 'head',
        units: '',
        password: 'farovon_' + Math.random().toString(36).slice(2, 6),
        phone: ''
      };
    }

    usedLogins.add(userToAdd.login.toLowerCase());

    // Generate bcrypt hash
    const hash = bcrypt.hashSync(userToAdd.password, 10);

    // Insert into Turso
    await executeSql(`
      INSERT INTO users (login, password_hash, fio, role, phone, units, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    `, [
      userToAdd.login,
      hash,
      userToAdd.fio,
      userToAdd.role,
      userToAdd.phone || null,
      userToAdd.units || ''
    ]);

    insertedCount++;

    exportRows.push([
      num,
      `"${name}"`,
      `"${userToAdd.fio}"`,
      `"${userToAdd.login}"`,
      `"${userToAdd.password}"`,
      `"${userToAdd.role}"`,
      `"${userToAdd.units || ''}"`,
      '"Добавлен в Turso"'
    ]);
  }

  // Write CSV export file
  const csvContent = '\uFEFF' + exportRows.map(r => r.join(';')).join('\r\n');
  fs.writeFileSync(exportPath, csvContent, 'utf8');

  console.log(`\n🎉 SUCCESS!`);
  console.log(`- Inserted new users into Turso: ${insertedCount}`);
  console.log(`- Skipped existing users (no duplicates): ${skippedCount}`);
  console.log(`- Total users in export file: ${targetLines.length}`);
  console.log(`- Export file saved at: ${exportPath}`);

  // Final Turso count
  const finalCount = (await getRows("SELECT count(*) as count FROM users;"))[0].count;
  console.log(`- Total users now in Turso database: ${finalCount}`);
}

uploadTargetUsers().catch(console.error);
