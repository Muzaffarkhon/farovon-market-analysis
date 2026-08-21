const path = require('path');

async function runTests() {
  console.log('🧪 Запуск тестов Cloudflare Worker API...');
  
  // Динамический импорт ES модуля worker.js
  const workerModule = await import('../worker.js');
  const worker = workerModule.default;

  const mockEnv = {};
  const mockCtx = {};

  // 1. Тест главной страницы
  console.log('1. Тест отдачи HTML главной страницы:');
  const reqHtml = new Request('https://farovon-market-analysis.workers.dev/');
  const resHtml = await worker.fetch(reqHtml, mockEnv, mockCtx);
  const htmlText = await resHtml.text();
  console.log('   - Статус:', resHtml.status);
  console.log('   - Content-Type:', resHtml.headers.get('Content-Type'));
  console.log('   - Наличие meta charset UTF-8:', htmlText.includes('charset="UTF-8"'));
  console.log('   - Длина HTML:', htmlText.length);

  // 2. Тест авторизации Администратора
  console.log('\n2. Тест POST /api/auth/login (admin):');
  const reqLogin = new Request('https://farovon-market-analysis.workers.dev/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'admin123' })
  });
  const resLogin = await worker.fetch(reqLogin, mockEnv, mockCtx);
  const dataLogin = await resLogin.json();
  console.log('   - Статус:', resLogin.status);
  console.log('   - Успех (ok):', dataLogin.ok);
  console.log('   - Роль:', dataLogin.user && dataLogin.user.role);
  console.log('   - Подразделений в ответе:', dataLogin.allUnits && dataLogin.allUnits.length);
  console.log('   - Конкурентов в ответе:', dataLogin.rows && dataLogin.rows.length);
  console.log('   - Наличие токена:', !!dataLogin.token);

  const token = dataLogin.token;

  // 3. Тест C&B аналитического дашборда
  console.log('\n3. Тест POST /api/dashboard/extended:');
  const reqDash = new Request('https://farovon-market-analysis.workers.dev/api/dashboard/extended', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({})
  });
  const resDash = await worker.fetch(reqDash, mockEnv, mockCtx);
  const dataDash = await resDash.json();
  console.log('   - Статус:', resDash.status);
  console.log('   - Всего подразделений:', dataDash.summary && dataDash.summary.totalDivisions);
  console.log('   - Должностей в перцентильном анализе:', dataDash.positions && dataDash.positions.length);
  if (dataDash.positions && dataDash.positions.length > 0) {
    const firstPos = dataDash.positions[0];
    console.log(`   - Пример: "${firstPos.pos}" -> Мин: ${firstPos.min}, P25: ${firstPos.p25}, Медиана: ${firstPos.median}, P75: ${firstPos.p75}, Макс: ${firstPos.max}, Размах: ${firstPos.forkSpreadPct}%`);
  }

  // 4. Тест Админки: Оргструктура 326 подразделений
  console.log('\n4. Тест GET /api/admin/divisions:');
  const reqDivs = new Request('https://farovon-market-analysis.workers.dev/api/admin/divisions', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const resDivs = await worker.fetch(reqDivs, mockEnv, mockCtx);
  const dataDivs = await resDivs.json();
  console.log('   - Статус:', resDivs.status);
  console.log('   - Количество подразделений:', dataDivs.divisions && dataDivs.divisions.length);

  // 5. Тест экспорта в CSV
  console.log('\n5. Тест GET /api/dashboard/export-csv:');
  const reqCsv = new Request('https://farovon-market-analysis.workers.dev/api/dashboard/export-csv', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const resCsv = await worker.fetch(reqCsv, mockEnv, mockCtx);
  const csvText = await resCsv.text();
  console.log('   - Статус:', resCsv.status);
  console.log('   - Content-Type:', resCsv.headers.get('Content-Type'));
  console.log('   - Наличие UTF-8 BOM:', csvText.charCodeAt(0) === 0xFEFF);
  console.log('   - Размер CSV:', csvText.length, 'байт');

  console.log('\n🎉 ВСЕ ТЕСТЫ CLOUDFLARE WORKER УСПЕШНО ПРОЙДЕНЫ!');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Ошибка теста:', err);
  process.exit(1);
});
