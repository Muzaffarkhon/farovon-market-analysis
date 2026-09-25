'use strict';

// Тестовые данные обзора рынка ДЛЯ ЛОКАЛЬНОЙ РАЗРАБОТКИ — заполняет то, что
// npm run db:dev оставляет пустым: сами анкеты обзора (surveys), внешний
// бенчмаркинг (data_sources/benchmark_datasets/source_positions/
// position_map/benchmark_rows) и вилки Фаровона по должности
// (dictionary_positions.pay_from/pay_to). Без этого «Реестр», «Бенчмаркинг»
// и вкладка «Зарплатные вилки» на дашборде — пустые экраны, хотя штатка и
// справочники уже засеяны (npm run db:dev делает только их).
//
// Запуск: node src/db/seedTestMarketData.js — отдельно от db:dev, чтобы не
// размывать его назначение (штатка/пользователи). Требует, чтобы db:dev уже
// отработал (нужны activePeriod, unit_positions, competitors, dev-логины).
// Идемпотентен: перед вставкой удаляет то, что сам же создал в прошлый раз
// (surveys с sid LIKE 'sim_%', всё под data_sources.key='demo_seed').

const config = require('../config');
const { run, queryOne, queryAll } = require('./database');
const { evaluatePosition } = require('../services/gradingService');

const SID_PREFIX = 'sim_';
const DEMO_SOURCE_KEY = 'demo_seed';

const SOURCES = ['Рыночные данные C&B', 'Резюме соискателей', 'HR контакты', 'Интервью', 'Аналитика рынка', 'Опрос'];
const TRUST = ['высокая', 'средняя', 'низкая'];
const SCHEDULES = ['5/2, 09:00–18:00', '2/2, 08:00–20:00', '6/1, 09:00–18:00', 'гибкий график'];
const BONUS_TYPES = ['KPI / Ежемесячный %', 'Квартальная премия', 'Годовой бонус (13-я ЗП)', 'Процент от продаж', 'Проектный бонус'];
const BONUS_PERIODS = ['в месяц', 'в квартал', 'в год'];
const BENEFIT_POOL = [
  'Оплата питания / Обеды', 'Корпоративная мобильная связь', 'Медицинское страхование (ДМС)',
  'Компенсация ГСМ / Транспорт', 'Обучение и тренинги за счёт компании', 'Служебный автомобиль',
  'Скидки на продукцию компании', 'Фитнес / Спортзал'
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickSome(arr, n) { return [...arr].sort(() => Math.random() - 0.5).slice(0, Math.max(0, n)); }
function round100(n) { return Math.round(n / 100) * 100; }

/** Грубая вилка по ключевым словам в названии должности — реального
 * бенчмарка на dev-базе нет, это только для правдоподобных тестовых чисел. */
function payRangeFor(position) {
  const p = String(position || '').toLowerCase();
  if (/директор|начальник|руководител|главн/.test(p)) return [12000, 25000];
  if (/менеджер|супервайзер|ведущ/.test(p)) return [7000, 14000];
  if (/специалист|бухгалтер|юрист|аналитик|инженер|hr\b/.test(p)) return [5000, 10000];
  return [3000, 6000];
}
function jitter([a, b]) {
  const from = round100(a * (0.9 + Math.random() * 0.2));
  const to = round100(Math.max(b * (0.9 + Math.random() * 0.2), from * 1.1));
  return [from, to];
}

async function seedSurveys(period, creators, anchorPositions) {
  await run(`DELETE FROM surveys WHERE sid LIKE ?`, [`${SID_PREFIX}%`]);

  const positions = await queryAll(`SELECT unit, position FROM unit_positions WHERE staff_count > 0`);
  const competitorsRows = await queryAll(`SELECT unit, company FROM competitors`);
  const byUnit = new Map();
  for (const c of competitorsRows) {
    if (!byUnit.has(c.unit)) byUnit.set(c.unit, []);
    byUnit.get(c.unit).push(c.company);
  }
  const fallbackCompanies = [...new Set(competitorsRows.map(c => c.company))].slice(0, 40);

  const sample = pickSome(positions, Math.min(positions.length, 350));
  // Якорные должности бенчмаркинга — добавляем несколько анкет с ИМЕНЕМ
  // ИЗ СПРАВОЧНИКА дословно (compare() в benchmarkService сверяет pos_our со
  // справочником регистронезависимо, но точно по строке), иначе «внутренний
  // сбор» на экране бенчмаркинга для них будет пуст, а внешний — заполнен.
  for (const ap of anchorPositions) {
    const unit = ap.unit || (positions[Math.floor(Math.random() * positions.length)] || {}).unit;
    if (!unit) continue;
    sample.push({ unit, position: ap.name });
  }

  let n = 0;
  let sidSeq = 1;
  for (const row of sample) {
    const companies = (byUnit.get(row.unit) && byUnit.get(row.unit).length) ? byUnit.get(row.unit) : fallbackCompanies;
    if (!companies.length) continue;
    const chosenCompanies = pickSome(companies, Math.min(companies.length, 2 + Math.round(Math.random())));
    const [baseFrom, baseTo] = payRangeFor(row.position);
    for (const company of chosenCompanies) {
      const [payFrom, payTo] = jitter([baseFrom, baseTo]);
      const bonRoll = Math.random();
      const bonHas = bonRoll < 0.7 ? 'да' : bonRoll < 0.9 ? 'нет' : 'не знаю';
      const bonSize = bonHas === 'да' ? `${5 + Math.round(Math.random() * 25)}%` : '';
      const bonType = bonHas === 'да' ? pick(BONUS_TYPES) : '';
      const bonPer = bonHas === 'да' ? pick(BONUS_PERIODS) : '';
      await run(
        `INSERT INTO surveys (sid, unit, company, pos_our, pos_their, grade, pay_from, pay_to, cur, pay_per,
           bon_has, bon_size, bon_type, bon_per, bonuses, benefits, schedule, extra, source, trust, note,
           created_by, created_at, state, period, period_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          `${SID_PREFIX}${sidSeq++}`, row.unit, company, row.position, row.position, '',
          payFrom, payTo, 'сомони', 'в месяц',
          bonHas, bonSize, bonType, bonPer,
          '', pickSome(BENEFIT_POOL, 1 + Math.round(Math.random() * 3)).join('; '), pick(SCHEDULES), '',
          pick(SOURCES), pick(TRUST), '',
          pick(creators), new Date().toISOString(), 'активна', period.name, period.id
        ]
      );
      n++;
    }
  }
  console.log(`✅ surveys: ${n} тестовых анкет (sid ${SID_PREFIX}*) по ${sample.length} парам подразделение×должность`);
}

/** Вилки Фаровона (dictionary_positions.pay_from/pay_to) — «наш» ориентир на
 * дашборде вилок и бенчмаркинге. Трогает только те строки, где сейчас 0,
 * реальные значения (если кто-то уже задал) не перезаписывает. */
async function seedForks(anchorPositions) {
  let updated = 0;
  for (const p of anchorPositions) {
    const [from, to] = jitter(payRangeFor(p.name));
    const res = await run(
      `UPDATE dictionary_positions SET pay_from = ?, pay_to = ? WHERE id = ? AND pay_from = 0 AND pay_to = 0`,
      [from, to, p.id]
    );
    if (Number(res.rowsAffected || 0) > 0) updated++;
  }
  console.log(`✅ вилки Фаровона: заполнены pay_from/pay_to у ${updated} должностей из справочника`);
}

async function seedBenchmark(anchorPositions) {
  // Идемпотентность: сносим то, что сами создали в прошлый раз, в порядке
  // внешних ключей (rows -> map -> source_positions -> dataset -> source).
  const oldDatasets = await queryAll(`SELECT id FROM benchmark_datasets WHERE source_key = ?`, [DEMO_SOURCE_KEY]);
  for (const d of oldDatasets) await run(`DELETE FROM benchmark_rows WHERE dataset_id = ?`, [d.id]);
  const oldPositions = await queryAll(`SELECT id FROM source_positions WHERE source_key = ?`, [DEMO_SOURCE_KEY]);
  for (const sp of oldPositions) await run(`DELETE FROM position_map WHERE source_position_id = ?`, [sp.id]);
  await run(`DELETE FROM source_positions WHERE source_key = ?`, [DEMO_SOURCE_KEY]);
  await run(`DELETE FROM benchmark_datasets WHERE source_key = ?`, [DEMO_SOURCE_KEY]);
  await run(`DELETE FROM data_sources WHERE key = ?`, [DEMO_SOURCE_KEY]);

  await run(
    `INSERT INTO data_sources (key, title, kind, is_licensed, default_currency, notes) VALUES (?,?,?,?,?,?)`,
    [DEMO_SOURCE_KEY, 'Демо-источник (тестовые данные)', 'consultancy', 0, 'сомони',
      'Синтетические данные, сгенерированы src/db/seedTestMarketData.js для проверки интерфейса локально']
  );
  const today = new Date().toISOString().slice(0, 10);
  const dsRes = await run(
    `INSERT INTO benchmark_datasets (source_key, title, report_date, data_as_of, currency, methodology, uploaded_by, row_count, state)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [DEMO_SOURCE_KEY, 'Демо-обзор рынка 2026 (тест)', today, today, 'сомони',
      'Синтетические данные для проверки интерфейса', 'dev.admin', 0, 'active']
  );
  const datasetId = Number(dsRes.lastInsertRowid || dsRes.insertId || 0);

  let rows = 0;
  for (const p of anchorPositions) {
    const spRes = await run(
      `INSERT INTO source_positions (source_key, code, label, family) VALUES (?,?,?,?)`,
      [DEMO_SOURCE_KEY, null, p.name, null]
    );
    const sourcePositionId = Number(spRes.lastInsertRowid || spRes.insertId || 0);
    await run(
      `INSERT INTO position_map (dict_position_id, source_position_id, confidence, mapped_by) VALUES (?,?,?,?)`,
      [p.id, sourcePositionId, 'exact', 'seedTestMarketData']
    );
    const [baseFrom, baseTo] = payRangeFor(p.name);
    const p25 = round100(baseFrom * (1 + Math.random() * 0.1));
    const p50 = round100((baseFrom + baseTo) / 2 * (0.95 + Math.random() * 0.1));
    const p75 = round100(baseTo * (0.9 + Math.random() * 0.1));
    for (const [statType, value] of [['p25', p25], ['p50', p50], ['p75', p75]]) {
      await run(
        `INSERT INTO benchmark_rows (dataset_id, source_position_id, region, industry, company_size, grade, component, currency, period, stat_type, value, sample_n, company)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [datasetId, sourcePositionId, 'Вся страна', null, null, null, 'base', 'сомони', 'в месяц', statType, value, 5 + Math.round(Math.random() * 30), null]
      );
      rows++;
    }
  }
  await run(`UPDATE benchmark_datasets SET row_count = ? WHERE id = ?`, [rows, datasetId]);
  console.log(`✅ бенчмаркинг: источник «${DEMO_SOURCE_KEY}», датасет #${datasetId}, ${anchorPositions.length} должностей, ${rows} строк`);
}

const GRADING_NOTE_MARK = 'seedTestMarketData';

/** Балл фактора (1–5) по грубой «должностной весовой категории» — та же
 * идея, что payRangeFor, только для семибалльной анкеты грейдирования, чтобы
 * итоговый балл хоть немного коррелировал с уровнем должности, а не был
 * чистым шумом. */
function tierMean(position) {
  const p = String(position || '').toLowerCase();
  if (/директор|начальник|руководител|главн/.test(p)) return 4.1;
  if (/менеджер|супервайзер|ведущ/.test(p)) return 3.1;
  if (/специалист|бухгалтер|юрист|аналитик|инженер|hr\b/.test(p)) return 2.5;
  return 1.7;
}
function factorsFor(position) {
  const base = tierMean(position);
  const arr = [];
  for (let i = 0; i < 7; i++) {
    // Сумма трёх Math.random() даёт треугольное распределение шума в [-1.5, 1.5]
    // вместо равномерного — оценки реже уходят в крайности 1/5.
    const noise = Math.random() + Math.random() + Math.random() - 1.5;
    arr.push(Math.min(5, Math.max(1, Math.round(base + noise))));
  }
  return arr;
}

/** Оценки должностей (грейдирование) — заполняет job_evaluations по части
 * пар «блок × должность» из уже засеянной grading_block_assignments, чтобы
 * карточки прогресса на /grading показывали реальную картину, а не 0%. */
async function seedGrading(creators) {
  await run(`DELETE FROM job_evaluations WHERE notes = ?`, [GRADING_NOTE_MARK]);

  const rows = await queryAll(`SELECT DISTINCT block_key, position, unit FROM grading_block_assignments`);
  if (!rows.length) {
    console.log('⚠️  grading_block_assignments пуст — оценки должностей пропущены (нет штатки/блоков)');
    return;
  }
  const seen = new Set();
  const targets = [];
  for (const r of rows) {
    const key = `${r.block_key}\u0000${r.position}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(r);
  }
  const sample = pickSome(targets, Math.round(targets.length * 0.65));

  let n = 0;
  for (const t of sample) {
    const result = evaluatePosition(factorsFor(t.position));
    const [f1, f2, f3, f4, f5, f6, f7] = result.factors;
    await run(
      `INSERT INTO job_evaluations
         (block_key, job_title, unit, factor_1, factor_2, factor_3, factor_4, factor_5, factor_6, factor_7,
          weighted_score, grade_level, evaluated_by, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t.block_key, t.position, t.unit, f1, f2, f3, f4, f5, f6, f7, result.weightedScore, result.gradeLevel, pick(creators), GRADING_NOTE_MARK]
    );
    n++;
  }
  console.log(`✅ оценка должностей: ${n} из ${targets.length} пар «блок×должность» (~65%, остальные — «не оценено» для реалистичной картины прогресса)`);
}

async function seedTestMarketData() {
  if (config.isProduction) {
    throw new Error('seedTestMarketData не предназначен для продакшена');
  }
  if (!config.usingDevDatabase) {
    throw new Error(
      'DEV_DATABASE_URL не задан — скрипт отказывается работать, чтобы не писать в боевую базу. ' +
      'Добавьте в .env строку DEV_DATABASE_URL=file:./data/dev.db (см. .env.example).'
    );
  }

  const period = await queryOne(`SELECT id, name FROM periods WHERE is_active = 1`);
  if (!period) throw new Error('Нет активного периода — сначала npm run db:dev');

  const creators = (await queryAll(
    `SELECT login FROM users WHERE login IN ('dev.hrbp','dev.cb','dev.admin')`
  )).map(u => u.login);
  if (!creators.length) throw new Error('Нет тестовых dev-логинов — сначала npm run db:dev');

  // Якорные должности бенчмаркинга — самые «населённые» по штатке, у них
  // есть реальный unit для примера и они реально что-то значат в компании.
  const topPositions = await queryAll(`
    SELECT position, unit, SUM(staff_count) AS total
    FROM unit_positions
    WHERE staff_count > 0
    GROUP BY position
    ORDER BY total DESC
    LIMIT 40
  `);
  const dictRows = await queryAll(`SELECT id, name FROM dictionary_positions`);
  const dictByName = new Map(dictRows.map(d => [d.name.toLowerCase().trim(), d]));
  const anchorPositions = [];
  for (const tp of topPositions) {
    const dict = dictByName.get(String(tp.position).toLowerCase().trim());
    if (dict) anchorPositions.push({ id: dict.id, name: dict.name, unit: tp.unit });
  }
  if (!anchorPositions.length) {
    // Штатка и справочник должностей называют одну и ту же роль по-разному —
    // берём просто первые 25 из справочника, лишь бы бенчмаркинг было на чём показать.
    for (const d of dictRows.slice(0, 25)) anchorPositions.push({ id: d.id, name: d.name, unit: null });
  }

  await seedSurveys(period, creators, anchorPositions);
  await seedForks(anchorPositions);
  await seedBenchmark(anchorPositions);
  await seedGrading(creators);
  console.log(`🎉 Тестовые рыночные данные готовы (${anchorPositions.length} якорных должностей для бенчмаркинга/вилок)`);
}

if (require.main === module) {
  seedTestMarketData()
    .then(() => process.exit(0))
    .catch(err => { console.error('❌', err.message); process.exit(1); });
}

module.exports = { seedTestMarketData };
