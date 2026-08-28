const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { queryAll, run } = require('../db/database');
const { getFioTokens } = require('./mergeDuplicateUsers');

function areFioMatching(fio1, fio2) {
  const t1 = getFioTokens(fio1);
  const t2 = getFioTokens(fio2);
  if (!t1.length || !t2.length) return false;
  const common = t1.filter(w => t2.includes(w));
  return common.length >= 2 || (t1.length === 1 && t2.length === 1 && t1[0] === t2[0]);
}

async function runEnrichment() {
  console.log('🔄 Сбор полных официальных ФИО (с отчествами)...');

  const files = fs.readdirSync(path.join(__dirname, '../../data')).filter(f => f.endsWith('.csv'));
  const fullFios = new Set();

  for (const f of files) {
    const raw = fs.readFileSync(path.join(__dirname, '../../data', f), 'utf8');
    const records = parse(raw, { skip_empty_lines: true, relax_column_count: true });
    for (const row of records) {
      for (const cell of row) {
        const val = String(cell || '').trim();
        const parts = val.split(/\s+/);
        if (parts.length === 3 && parts.every(p => p.length >= 2)) {
          // Проверяем, что это имя человека (не название отдела/компании)
          if (/^[А-ЯЁҒӢҚЎҲҶ][а-яёғӣқўҳҷ]+\s+[А-ЯЁҒӢҚЎҲҶ][а-яёғӣқўҳҷ]+\s+[А-ЯЁҒӢҚЎҲҶ][а-яёғӣқўҳҷ]+$/.test(val)) {
            fullFios.add(val);
          }
        }
      }
    }
  }

  console.log(`Найдено уникальных полных ФИО (с отчествами): ${fullFios.size}`);

  const activeUsers = await queryAll('SELECT id, login, fio, units FROM users WHERE archived_at IS NULL');
  console.log(`Активных пользователей в БД: ${activeUsers.length}`);

  let updatedUsers = 0;
  for (const user of activeUsers) {
    const matchedFullFio = Array.from(fullFios).find(f => areFioMatching(user.fio, f));
    if (matchedFullFio && matchedFullFio !== user.fio) {
      console.log(`  👤 Пользователь ${user.login}: "${user.fio}" -> "${matchedFullFio}"`);
      await run('UPDATE users SET fio = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [matchedFullFio, user.id]);
      updatedUsers++;
    }
  }

  // Обновляем подразделения
  const freshUsers = await queryAll('SELECT id, fio FROM users WHERE archived_at IS NULL');
  const divisions = await queryAll('SELECT id, unit, head, resp, hrbp FROM divisions');
  let updatedDivs = 0;

  for (const div of divisions) {
    let newHead = div.head;
    let newResp = div.resp;
    let newHrbp = div.hrbp;

    const findBestFio = (name) => {
      if (!name || typeof name !== 'string') return name;
      // Сначала ищем среди полных ФИО
      const fromDict = Array.from(fullFios).find(f => areFioMatching(name, f));
      if (fromDict) return fromDict;
      const fromUsers = freshUsers.find(u => areFioMatching(name, u.fio));
      if (fromUsers) return fromUsers.fio;
      return name;
    };

    if (div.head) newHead = findBestFio(div.head);
    if (div.resp) newResp = findBestFio(div.resp);
    if (div.hrbp) newHrbp = findBestFio(div.hrbp);

    if (newHead !== div.head || newResp !== div.resp || newHrbp !== div.hrbp) {
      await run('UPDATE divisions SET head = ?, resp = ?, hrbp = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [newHead, newResp, newHrbp, div.id]);
      updatedDivs++;
    }
  }

  console.log(`✅ Итог: обновлено пользователей: ${updatedUsers}, обновлено подразделений: ${updatedDivs}`);
}

if (require.main === module) {
  runEnrichment()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Ошибка:', err);
      process.exit(1);
    });
}

module.exports = { runEnrichment };
