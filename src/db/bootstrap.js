'use strict';

// Создание схемы с нуля: базовые таблицы из schema.sql, затем идемпотентные
// миграции (migrate.js) — они наращивают схему поверх базовой и сами по себе
// на пустой базе не работают.
//
// Боевая база создавалась вручную задолго до этого файла, поэтому schema.sql
// нигде в коде не применялся. Нужен он в двух случаях: поднять локальную базу
// для разработки (DEV_DATABASE_URL, см. .env.example) и восстановить схему с
// нуля, если понадобится.
//
// Все операторы — CREATE TABLE/INDEX IF NOT EXISTS, поэтому повторный запуск
// на живой базе ничего не меняет.

const fs = require('fs');
const path = require('path');
const { run } = require('./database');
const { migrate } = require('./migrate');

/**
 * Разбор schema.sql на операторы.
 *
 * Комментарии снимаются ДО разделения по «;»: в пояснениях к колонкам есть
 * точки с запятой («NULL — не заблокирован; иначе ISO-время…»), и без этого
 * оператор рвётся посередине. Строковых литералов с «--» в схеме нет.
 */
function readStatements() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  return sql
    .split(/\r?\n/)
    .map(line => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const statements = readStatements();
  for (const stmt of statements) {
    await run(stmt);
  }
  console.log(`🔧 Базовая схема применена (операторов: ${statements.length})`);
  await migrate();
}

module.exports = { bootstrap, readStatements };

if (require.main === module) {
  bootstrap()
    .then(() => { console.log('✅ Схема базы готова'); process.exit(0); })
    .catch(err => { console.error('❌ Не удалось применить схему:', err.message); process.exit(1); });
}
