// Разовый скрипт: очищает только заполненные анкеты (surveys) и привязанный
// к ним выбор компаний по должностям (position_company_selections).
// НЕ трогает справочники (dictionary_companies, dictionary_positions),
// competitors, оргструктуру (divisions), пользователей и периоды.
//
// Подключается через реквизиты Turso из .env (см. tursoEnv.js) — то есть
// работает с тем окружением, которое сейчас активно в TURSO_DATABASE_URL.
// Перед прод-запуском обязательно проверить, что в .env указана именно
// боевая база.
const https = require('https');
const { TURSO_URL_PIPELINE: TURSO_URL, TURSO_TOKEN, TURSO_URL_LIBSQL } = require('./tursoEnv');

async function executeSql(sql, args = []) {
  const requests = [
    {
      type: 'execute',
      stmt: {
        sql,
        args: args.map(a => {
          if (a === null) return { type: 'null' };
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

async function countRows(table) {
  const res = await executeSql(`SELECT COUNT(*) FROM ${table}`);
  return Number(res.rows[0][0].value);
}

async function run() {
  console.log(`База: ${TURSO_URL_LIBSQL}`);
  if (process.env.CONFIRM !== 'YES_DELETE_SURVEYS') {
    console.error('❌ Не задан CONFIRM=YES_DELETE_SURVEYS — запуск остановлен (защита от случайного удаления).');
    process.exit(1);
  }

  const surveysBefore = await countRows('surveys');
  const selectionsBefore = await countRows('position_company_selections');
  console.log(`До очистки: surveys=${surveysBefore}, position_company_selections=${selectionsBefore}`);

  await executeSql('DELETE FROM surveys');
  await executeSql('DELETE FROM position_company_selections');

  const surveysAfter = await countRows('surveys');
  const selectionsAfter = await countRows('position_company_selections');
  console.log(`После очистки: surveys=${surveysAfter}, position_company_selections=${selectionsAfter}`);
  console.log('Справочники (dictionary_companies, dictionary_positions), competitors, оргструктура и пользователи не тронуты.');
}

run().catch(err => {
  console.error('Ошибка:', err.message);
  process.exit(1);
});
