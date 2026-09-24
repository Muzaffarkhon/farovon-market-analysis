'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRegistry, buildRegistryAll, toCsv, isUnmapped } = require('../src/services/registryService');
const { unitScopeFilter } = require('../src/services/scopeService');

const divisions = [
  { num: 1, dir: 'Дивизион Север', unit: 'Цех 1', hrbp: 'Иванов И.', region: 'Худжанд' },
  { num: 2, dir: 'Дивизион Север', unit: 'Цех 2', hrbp: 'Иванов И.', region: 'Худжанд' },
  { num: 3, dir: 'Дивизион Юг', unit: 'Цех 3', hrbp: 'Петров П.', region: 'Душанбе' }
];

const survey = (over = {}) => ({
  id: 1, sid: 's1', unit: 'Цех 1', company: 'Алиф', pos_our: 'Токарь', pos_their: 'Токарь 3р',
  grade: 'G7', pay_from: 3000, pay_to: 5000, cur: 'сомони', pay_per: 'в месяц',
  bon_has: 'нет', bon_size: '', bon_type: '', bon_per: '', bonuses: '',
  benefits: 'ДМС;Обеды', schedule: '5/2 · 40 часов', extra: '', source: 'Интервью',
  trust: 'высокая', note: '', created_by: 'hrbp1', created_at: '2026-09-01 10:00:00',
  state: 'активна', ...over
});

const build = (surveys, filters, opts) =>
  buildRegistry({ surveys, divisions }, filters, opts);

// ── Строка реестра ─────────────────────────────────────────────────────────

test('строка собирает и анкету, и данные подразделения', () => {
  const r = build([survey()]).rows[0];
  assert.equal(r.company, 'Алиф');
  assert.equal(r.dir, 'Дивизион Север');
  assert.equal(r.region, 'Худжанд');
  assert.equal(r.hrbp, 'Иванов И.');
  assert.equal(r.grade, 'G7');
  assert.equal(r.trust, 'высокая');
  assert.deepEqual(r.benefits, ['ДМС', 'Обеды']);
});

test('регион берётся из примечания, когда у подразделения его нет', () => {
  const r = build([survey({ unit: 'Цех без региона', note: 'Собрал: Х; Регион: Канибадам; ID_Бизнес: 11' })]).rows[0];
  assert.equal(r.region, 'Канибадам');
});

test('все виды переменной части разбираются, а не только первый', () => {
  const bonuses = JSON.stringify([
    { type: 'KPI', size: '20', per: 'в месяц' },
    { type: 'Годовая', size: '1 оклад', per: 'в год' }
  ]);
  const r = build([survey({ bon_has: 'да', bonuses })]).rows[0];
  assert.equal(r.bonuses.length, 2);
  assert.equal(r.varPay.has, true);
});

test('компании вне обзора рынка (ООО) в реестр не попадают', () => {
  const res = build([survey(), survey({ id: 2, sid: 's2', company: 'ООО Ромашка' })]);
  assert.equal(res.total, 1);
});

test('«не сопоставлено» распознаётся и считается отдельно', () => {
  assert.equal(isUnmapped({ posOur: '(не сопоставлено)' }), true);
  assert.equal(isUnmapped({ posOur: '' }), true);
  assert.equal(isUnmapped({ posOur: 'Токарь' }), false);
  const res = build([survey(), survey({ id: 2, sid: 's2', pos_our: '(не сопоставлено)' })]);
  assert.equal(res.unmapped, 1);
});

// ── Фильтры ────────────────────────────────────────────────────────────────

const mixed = [
  survey(),
  survey({ id: 2, sid: 's2', unit: 'Цех 3', company: 'Сиёма', pos_our: 'Сварщик', source: 'Сайт', trust: 'низкая' }),
  survey({ id: 3, sid: 's3', unit: 'Цех 2', company: 'Алиф', pos_our: 'Токарь', trust: 'средняя', cur: 'доллар' })
];

test('фильтр по точному значению', () => {
  assert.equal(build(mixed, { company: 'Алиф' }).total, 2);
  assert.equal(build(mixed, { trust: 'низкая' }).total, 1);
  assert.equal(build(mixed, { cur: 'доллар' }).total, 1);
  assert.equal(build(mixed, { dir: 'Дивизион Юг' }).total, 1);
});

test('фильтры складываются', () => {
  assert.equal(build(mixed, { company: 'Алиф', trust: 'средняя' }).total, 1);
  assert.equal(build(mixed, { company: 'Алиф', trust: 'низкая' }).total, 0);
});

test('поиск идёт по компании, должностям, подразделению, автору и комментарию', () => {
  assert.equal(build(mixed, { search: 'сварщик' }).total, 1);
  assert.equal(build(mixed, { search: 'алиф' }).total, 2);
  assert.equal(build(mixed, { search: 'hrbp1' }).total, 3);
  assert.equal(build(mixed, { search: 'ничего' }).total, 0);
  const withNote = [survey({ note: 'уточнить у бухгалтерии' })];
  assert.equal(build(withNote, { search: 'бухгалтер' }).total, 1);
});

test('«только несопоставленные», «только с окладом», «только с прочими выплатами»', () => {
  const rows = [
    survey(), survey({ id: 2, sid: 's2', pos_our: '(не сопоставлено)' }),
    survey({ id: 3, sid: 's3', pay_from: 0, pay_to: 0 }),
    survey({ id: 4, sid: 's4', extra: 'ГСМ компенсация' })
  ];
  assert.equal(build(rows, { onlyUnmapped: true }).total, 1);
  assert.equal(build(rows, { withPayOnly: true }).total, 3);
  assert.equal(build(rows, { withExtraOnly: true }).total, 1);
});

// ── Источник записи (вручную / импорт) ──────────────────────────────────────

test('sid с префиксом s_ — запись вручную, imp_ — импорт из Excel', () => {
  const manual = build([survey({ sid: 's_abc' })]).rows[0];
  const imported = build([survey({ sid: 'imp_abc' })]).rows[0];
  assert.equal(manual.recordSource, 'manual');
  assert.equal(imported.recordSource, 'import');
});

test('источник записи фильтруется и попадает в грани', () => {
  const rows = [survey({ sid: 's_a' }), survey({ id: 2, sid: 'imp_b' })];
  assert.deepEqual(build(rows).facets.recordSources.sort(), ['import', 'manual']);
  assert.equal(build(rows, { recordSource: 'import' }).total, 1);
});

// ── Грани ──────────────────────────────────────────────────────────────────

test('грани собираются по видимым строкам до применения фильтров', () => {
  const res = build(mixed, { company: 'Алиф' });
  assert.deepEqual(res.facets.companies, ['Алиф', 'Сиёма']);
  assert.equal(res.total, 2);
});

test('пустые значения в грани не попадают', () => {
  const res = build([survey({ grade: '' }), survey({ id: 2, sid: 's2', grade: 'G5' })]);
  assert.deepEqual(res.facets.grades, ['G5']);
});

// ── Сортировка и страницы ──────────────────────────────────────────────────

test('по умолчанию новые записи сверху', () => {
  const rows = [
    survey({ id: 1, sid: 'a', created_at: '2026-09-01 10:00:00' }),
    survey({ id: 2, sid: 'b', created_at: '2026-09-05 10:00:00' })
  ];
  assert.equal(build(rows).rows[0].id, 'b');
});

test('сортировка по числовой колонке — числом, а не строкой', () => {
  const rows = [
    survey({ id: 1, sid: 'a', pay_from: 900 }),
    survey({ id: 2, sid: 'b', pay_from: 10000 })
  ];
  assert.equal(build(rows, { sort: 'payFrom', order: 'asc' }).rows[0].id, 'a');
  assert.equal(build(rows, { sort: 'payFrom', order: 'desc' }).rows[0].id, 'b');
});

test('сортировка по полю вне белого списка откатывается на дату', () => {
  const rows = [
    survey({ id: 1, sid: 'a', created_at: '2026-09-01 10:00:00', note: 'я' }),
    survey({ id: 2, sid: 'b', created_at: '2026-09-05 10:00:00', note: 'а' })
  ];
  // Поля не из SORTABLE (выдуманное имя) откатываются на дату — запрошенный
  // порядок сохранён, а не наугад что-то ещё.
  assert.equal(build(rows, { sort: 'not_a_real_column', order: 'asc' }).rows[0].id, 'a');
});

test('комментарий (примечание) тоже сортируется — колонка «Комментарий» кликабельна как остальные', () => {
  const rows = [
    survey({ id: 1, sid: 'a', note: 'я' }),
    survey({ id: 2, sid: 'b', note: 'а' })
  ];
  assert.equal(build(rows, { sort: 'note', order: 'asc' }).rows[0].id, 'b');
});

test('страница режется по размеру, номер зажимается в границы', () => {
  const rows = Array.from({ length: 7 }, (_, i) => survey({ id: i + 1, sid: 's' + i }));
  const p1 = build(rows, { page: 1, perPage: 3 });
  assert.equal(p1.rows.length, 3);
  assert.equal(p1.pages, 3);
  assert.equal(p1.total, 7);
  assert.equal(build(rows, { page: 99, perPage: 3 }).page, 3);
  assert.equal(build(rows, { page: 0, perPage: 3 }).page, 1);
});

test('размер страницы ограничен сверху', () => {
  assert.equal(build([survey()], { perPage: 100000 }).perPage, 200);
});

test('сортировка работает по любой добавленной колонке, не только по прежним пяти', () => {
  const rows = [
    survey({ id: 1, sid: 'a', grade: 'G3', pos_their: 'Б', cur: 'доллар', schedule: '5/2 · 40 часов' }),
    survey({ id: 2, sid: 'b', grade: 'G9', pos_their: 'А', cur: 'сомони', schedule: '6/1 · 54 часа' })
  ];
  assert.equal(build(rows, { sort: 'grade', order: 'asc' }).rows[0].id, 'a');
  assert.equal(build(rows, { sort: 'posTheir', order: 'asc' }).rows[0].id, 'b');
  // «доллар» раньше «сомони» по алфавиту.
  assert.equal(build(rows, { sort: 'cur', order: 'asc' }).rows[0].id, 'a');
  assert.equal(build(rows, { sort: 'schedule', order: 'asc' }).rows[0].id, 'a');
});

// ── Совокупно в месяц ────────────────────────────────────────────────────

test('совокупно в месяц: оклад плюс премия, приведённая к месяцу', () => {
  const r = build([survey({ pay_from: 4000, pay_to: 6000, bon_has: 'да', bon_type: 'KPI', bon_size: '10%', bon_per: 'в месяц' })]).rows[0];
  // mid = 5000, +10% = 500 → 5500
  assert.equal(r.totalMonthly, 5500);
});

test('совокупно в месяц пусто, если размер премии не распознан', () => {
  const r = build([survey({ bon_has: 'да', bon_type: 'KPI', bon_size: '', bon_per: '' })]).rows[0];
  assert.equal(r.totalMonthly, null);
});

test('совокупно в месяц: явное «нет премии» — известный ноль, а не прочерк', () => {
  const r = build([survey({ pay_from: 4000, pay_to: 6000, bon_has: 'нет' })]).rows[0];
  assert.equal(r.totalMonthly, 5000);
});

test('совокупно в месяц пусто без оклада', () => {
  const r = build([survey({ pay_from: 0, pay_to: 0, bon_has: 'нет' })]).rows[0];
  assert.equal(r.totalMonthly, null);
});

test('сортировка по совокупному доходу переносит записи без данных в конец', () => {
  const rows = [
    survey({ id: 1, sid: 'a', pay_from: 5000, pay_to: 5000, bon_has: 'нет' }), // totalMonthly = 5000
    survey({ id: 2, sid: 'b', pay_from: 0, pay_to: 0, bon_has: 'нет' }), // totalMonthly = null
    survey({ id: 3, sid: 'c', pay_from: 8000, pay_to: 8000, bon_has: 'нет' }) // totalMonthly = 8000
  ];
  assert.deepEqual(build(rows, { sort: 'totalMonthly', order: 'asc' }).rows.map(r => r.id), ['a', 'c', 'b']);
  assert.deepEqual(build(rows, { sort: 'totalMonthly', order: 'desc' }).rows.map(r => r.id), ['c', 'a', 'b']);
});

test('сортировка по льготам — по их числу', () => {
  const rows = [
    survey({ id: 1, sid: 'a', benefits: 'ДМС' }),
    survey({ id: 2, sid: 'b', benefits: 'ДМС;Обеды;Связь' })
  ];
  assert.equal(build(rows, { sort: 'benefitsCount', order: 'asc' }).rows[0].id, 'a');
  assert.equal(build(rows, { sort: 'benefitsCount', order: 'desc' }).rows[0].id, 'b');
});

// ── Видимость по роли ──────────────────────────────────────────────────────

test('admin и C&B видят весь рынок', () => {
  const opts = { unitFilter: unitScopeFilter({ role: 'cb' }) };
  assert.equal(build(mixed, {}, opts).total, 3);
  assert.equal(build(mixed, {}, opts).scoped, false);
});

test('HR BP видит только свои подразделения', () => {
  // Второй аргумент — то, что в контроллере даёт unitsForUser(user.id,
  // 'hrbp') (division_assignments), здесь передаём напрямую.
  const opts = { unitFilter: unitScopeFilter({ role: 'hrbp', units: [] }, new Set(['Цех 3'])) };
  const res = build(mixed, {}, opts);
  assert.equal(res.total, 1);
  assert.equal(res.rows[0].unit, 'Цех 3');
  assert.equal(res.scoped, true);
});

test('руководитель видит закреплённые подразделения', () => {
  const opts = { unitFilter: unitScopeFilter({ role: 'head', fio: 'Сидоров', units: ['Цех 2'] }) };
  assert.equal(build(mixed, {}, opts).total, 1);
});

test('чужие строки не видны и в гранях', () => {
  const opts = { unitFilter: unitScopeFilter({ role: 'head', fio: 'Сидоров', units: ['Цех 2'] }) };
  assert.deepEqual(build(mixed, {}, opts).facets.companies, ['Алиф']);
});

// ── Выгрузка ───────────────────────────────────────────────────────────────

test('выгрузка отдаёт все отфильтрованные строки без страницы', () => {
  const rows = Array.from({ length: 7 }, (_, i) => survey({ id: i + 1, sid: 's' + i }));
  assert.equal(buildRegistryAll({ surveys: rows, divisions }, { perPage: 3 }).rows.length, 7);
});

test('CSV: шапка, разделитель «;» и экранирование кавычек', () => {
  const rows = buildRegistryAll({ surveys: [survey({ company: 'Ал"иф; и Ко' })], divisions }, {}).rows;
  const csv = toCsv(rows);
  const [head, line] = csv.split('\r\n');
  assert.ok(head.startsWith('Дата;Направление;Подразделение'));
  assert.ok(line.includes('"Ал""иф; и Ко"'));
});

test('CSV разворачивает списки читаемо', () => {
  const rows = buildRegistryAll({ surveys: [survey()], divisions }, {}).rows;
  assert.ok(toCsv(rows).includes('ДМС, Обеды'));
});
