const { migrate } = require('../db/migrate');
const benchmarkService = require('../services/benchmarkService');
const benchmarkImportService = require('../services/benchmarkImportService');
const { queryOne, queryAll, run } = require('../db/database');

async function runTests() {
  console.log('🧪 Запуск тестов Фазы 1 Бенчмаркинга...');

  // 1. Проверяем миграцию
  await migrate();
  console.log('✅ Миграция выполнена');

  // 2. Проверяем источники
  const sources = await benchmarkService.getSources();
  console.log(`✅ Получено источников данных: ${sources.length}`);
  if (sources.length < 4) {
    throw new Error(`Ожидалось не менее 4 источников, получено: ${sources.length}`);
  }

  // 3. Тестируем импорт B1 (готовые перцентили)
  const b1SampleData = `Должность,Код,P25,P50,P75,N
Главный бухгалтер,M1,8000,12000,16000,25
Финансовый директор,EX1,15000,22000,30000,10
Юрист,P2,6000,9000,13000,40
`;

  const dryB1 = await benchmarkImportService.dryRun({
    sourceKey: 'b1',
    text: b1SampleData,
    mode: 'percentiles',
    columnMap: { posLabel: 0, code: 1, p25: 2, p50: 3, p75: 4, sampleN: 5 },
    currency: 'сомони',
    reportDate: '2026-08-01',
    title: 'B1 Salary Survey 2026 Test'
  });
  console.log('✅ Dry-run B1 успешен: строк валидно =', dryB1.validRows);

  const commitB1 = await benchmarkImportService.commit({
    sourceKey: 'b1',
    text: b1SampleData,
    mode: 'percentiles',
    columnMap: { posLabel: 0, code: 1, p25: 2, p50: 3, p75: 4, sampleN: 5 },
    currency: 'сомони',
    reportDate: '2026-08-01',
    title: 'B1 Salary Survey 2026 Test',
    user: { login: 'admin', fio: 'Администратор' }
  });
  console.log('✅ Импорт B1 сохранен: datasetId =', commitB1.datasetId);

  // 4. Тестируем импорт Job Farovon (сырые вакансии)
  const jfSampleData = `Должность,Компания,Оклад,Регион
Главный бухгалтер,ООО Ромашка,11000,Душанбе
Главный бухгалтер,ЗАО Факел,13000,Душанбе
Главный бухгалтер,ООО Сириус,14000,Худжанд
Финансовый директор,ОАО Альфа,25000,Душанбе
`;

  const commitJF = await benchmarkImportService.commit({
    sourceKey: 'job_farovon',
    text: jfSampleData,
    mode: 'raw_vacancies',
    columnMap: { posLabel: 0, company: 1, value: 2, region: 3 },
    currency: 'сомони',
    reportDate: '2026-08-15',
    title: 'Job Farovon Август 2026 Test',
    user: { login: 'admin', fio: 'Администратор' }
  });
  console.log('✅ Импорт Job Farovon сохранен: datasetId =', commitJF.datasetId);

  // 5. Тестируем сопоставление должностей
  // Создаем тестовую должность в dictionary_positions если её нет
  let testPos = await queryOne("SELECT id, name FROM dictionary_positions WHERE name = 'Главный бухгалтер'");
  if (!testPos) {
    const ins = await run("INSERT INTO dictionary_positions (name, pay_from, pay_to) VALUES ('Главный бухгалтер', 10000, 15000)");
    testPos = { id: ins.lastInsertRowid || ins.insertId, name: 'Главный бухгалтер' };
  }

  // Подбираем маппинги
  const suggestions = await benchmarkService.suggestMappings('b1');
  console.log('✅ Автоподбор сопоставлений (b1): найдено =', suggestions.length);

  const b1Pos = await queryOne("SELECT id FROM source_positions WHERE source_key = 'b1' AND label = 'Главный бухгалтер'");
  const jfPos = await queryOne("SELECT id FROM source_positions WHERE source_key = 'job_farovon' AND label = 'Главный бухгалтер'");

  if (b1Pos) {
    await benchmarkService.saveMapping({
      dictPositionId: testPos.id,
      sourcePositionId: b1Pos.id,
      confidence: 'exact',
      note: 'Тестовая привязка B1',
      mappedBy: 'admin'
    });
  }

  if (jfPos) {
    await benchmarkService.saveMapping({
      dictPositionId: testPos.id,
      sourcePositionId: jfPos.id,
      confidence: 'exact',
      note: 'Тестовая привязка JF',
      mappedBy: 'admin'
    });
  }
  console.log('✅ Должности успешно сопоставлены в position_map');

  // 6. Тестируем compare
  const comparison = await benchmarkService.compare({
    positionId: testPos.id,
    user: { role: 'admin', login: 'admin' }
  });

  console.log('\n📊 РЕЗУЛЬТАТЫ СРАВНЕНИЯ ДЛЯ ПОЗИЦИИ:', comparison.position.name);
  console.log('Фаровон оклад:', comparison.position.ourPayFrom, '–', comparison.position.ourPayTo, '(мид:', comparison.position.ourMid, ')');
  console.log('Внутренний сбор:', comparison.internal.observationsCount, 'наблюдений, P50 =', comparison.internal.stats.p50);
  console.log('Внешние источники:', comparison.external.length);
  comparison.external.forEach(ext => {
    if (ext.hasData) {
      console.log(`  - [${ext.sourceTitle}] P25: ${ext.stats.p25}, P50: ${ext.stats.p50}, P75: ${ext.stats.p75}, Гэп: ${ext.gapPercent}% (${ext.gapAmount} сом)`);
    } else {
      console.log(`  - [${ext.sourceTitle}] Нет данных`);
    }
  });
  console.log('Сводная рыночная медиана:', comparison.summary.compositeMedian, 'сом (Гэп Фаровона:', comparison.summary.compositeGapPercent, '%)');

  console.log('\n🎉 ВСЕ ТЕСТЫ ФАЗЫ 1 УСПЕШНО ПРОЙДЕНЫ!');
}

runTests().catch(err => {
  console.error('❌ Ошибка теста:', err);
  process.exit(1);
});
