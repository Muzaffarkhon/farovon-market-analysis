const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { queryAll, batch } = require('../db/database');

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  const rows = [];
  for (const line of lines) {
    const parts = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQ = !inQ;
      } else if (c === ';' && !inQ) {
        parts.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    parts.push(cur.trim());
    rows.push(parts);
  }
  return rows;
}

async function syncAllPasswordsToTurso() {
  console.log('🔄 Синхронизируем пароли всех пользователей из Доступы_пользователей_для_выдачи.csv в Turso...');

  const csvPath = 'C:\\Users\\Acer\\OneDrive\\Desktop\\данные\\Доступы_пользователей_для_выдачи.csv';
  if (!fs.existsSync(csvPath)) {
    console.error('❌ CSV файл не найден:', csvPath);
    return;
  }

  const content = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(content);
  // Header: №;ФИО (из списка);ФИО в системе;Логин;Пароль;Роль;Подразделения;Статус в Turso

  const stmts = [];
  let count = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const login = (r[3] || '').trim();
    const pwd = (r[4] || '').trim();
    const fio = (r[2] || r[1] || '').trim();
    const role = (r[5] || 'guest').trim();
    const units = (r[6] || '').trim();

    if (!login || !pwd) continue;

    const hash = bcrypt.hashSync(pwd, 10);
    stmts.push({
      sql: `UPDATE users SET password_hash = ?, fio = COALESCE(NULLIF(fio, ''), ?), role = COALESCE(NULLIF(role, ''), ?), active = 1 WHERE LOWER(login) = LOWER(?)`,
      args: [hash, fio, role, login]
    });
    count++;
  }

  // Also ensure admin and cb
  stmts.push({
    sql: `UPDATE users SET password_hash = ? WHERE LOWER(login) = 'admin'`,
    args: [bcrypt.hashSync('09630801', 10)]
  });
  stmts.push({
    sql: `UPDATE users SET password_hash = ? WHERE LOWER(login) = 'cb'`,
    args: [bcrypt.hashSync('00000000', 10)]
  });

  console.log(`Подготовлено ${stmts.length} запросов обновления паролей.`);

  // Выполняем пачками по 30
  for (let i = 0; i < stmts.length; i += 30) {
    const chunk = stmts.slice(i, i + 30);
    await batch(chunk);
    console.log(`Обновлено ${Math.min(i + 30, stmts.length)} из ${stmts.length}...`);
  }

  console.log('✅ Все пароли успешно синхронизированы в Turso!');
}

syncAllPasswordsToTurso().catch(console.error);
