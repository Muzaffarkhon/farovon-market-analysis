'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCoordination } = require('../src/services/coordinationService');
const { unitScopeFilter } = require('../src/services/scopeService');

const divisions = [
  { num: 1, dir: 'Дивизион Север', unit: 'Цех 1', resp: 'Иванов Иван', head: '', hrbp: 'Петрова П.' },
  { num: 2, dir: 'Дивизион Север', unit: 'Цех 2', resp: '', head: 'Сидоров Сидор', hrbp: 'Петрова П.' },
  { num: 3, dir: 'Дивизион Юг', unit: 'Цех 3', resp: '', head: '', hrbp: 'Козлова К.' },
  // подразделение без штатки вовсе — не должно выглядеть «полностью»
  { num: 4, dir: 'Дивизион Юг', unit: 'Склад', resp: '', head: '', hrbp: 'Козлова К.' }
];

const unitPositions = [
  { unit: 'Цех 1', position: 'Токарь' },
  { unit: 'Цех 1', position: 'Слесарь' },
  { unit: 'Цех 2', position: 'Мастер' },
  { unit: 'Цех 3', position: 'Продавец' }
];

const survey = (over = {}) => ({
  unit: 'Цех 1', company: 'Алиф', pos_our: 'Токарь', pay_from: 3000, pay_to: 5000,
  bonuses: '', bon_type: '', bon_size: '', bon_per: '', benefits: 'ДМС', extra: '', note: '',
  created_by: 'hrbp1', created_at: '2026-09-01 10:00:00', ...over
});

const users = [
  { id: 1, login: 'ivanov', fio: 'Иванов Иван', units: '', last_login_at: '2026-09-10', telegram_chat_id: '111' },
  { id: 2, login: 'sidorov', fio: 'Сидоров Сидор', units: 'Цех 2', last_login_at: '', telegram_chat_id: null },
  { id: 3, login: 'nobody', fio: 'Никто Нигде', units: '', last_login_at: '2026-09-01', telegram_chat_id: '999' }
];

// division_assignments — ID-связь, замена текстового resp/head (см. divisions
// выше: Иванов резолвится в resp Цеха 1, Сидоров — head Цеха 2).
const assignments = [
  { unit: 'Цех 1', userId: 1 },
  { unit: 'Цех 2', userId: 2 }
];

const build = (opts = {}, unitFilter) => buildCoordination({
  divisions: opts.divisions || divisions,
  unitPositions: opts.unitPositions || unitPositions,
  surveys: opts.surveys || [],
  noComparison: opts.noComparison || [],
  users: opts.users || users,
  assignments: opts.assignments || assignments
}, unitFilter);

// ── Подразделения ───────────────────────────────────────────────────────────

test('подразделение без штатки — «не начато», а не «полностью»', () => {
  const res = build();
  const sklad = res.units.find(u => u.unit === 'Склад');
  assert.equal(sklad.positionsTotal, 0);
  assert.equal(sklad.state, 'не начато');
});

test('подразделение без единой заполненной записи — «не начато»', () => {
  const res = build();
  const tsex3 = res.units.find(u => u.unit === 'Цех 3');
  assert.equal(tsex3.positionsTotal, 1);
  assert.equal(tsex3.positionsDecided, 0);
  assert.equal(tsex3.state, 'не начато');
});

test('часть должностей решена — «в процессе»', () => {
  const res = build({ surveys: [survey()] }); // закрывает «Токарь» в Цехе 1, «Слесарь» — нет
  const tsex1 = res.units.find(u => u.unit === 'Цех 1');
  assert.equal(tsex1.positionsTotal, 2);
  assert.equal(tsex1.positionsDecided, 1);
  assert.equal(tsex1.state, 'в процессе');
});

test('все должности решены — «полностью»', () => {
  const res = build({
    unitPositions: [{ unit: 'Цех 1', position: 'Токарь' }],
    surveys: [survey()]
  });
  const tsex1 = res.units.find(u => u.unit === 'Цех 1');
  assert.equal(tsex1.state, 'полностью');
});

test('отметка «не с кем» тоже закрывает должность', () => {
  const res = build({
    unitPositions: [{ unit: 'Цех 3', position: 'Продавец' }],
    noComparison: [{ unit: 'Цех 3', pos_our: 'Продавец' }]
  });
  const tsex3 = res.units.find(u => u.unit === 'Цех 3');
  assert.equal(tsex3.positionsDecided, 1);
  assert.equal(tsex3.state, 'полностью');
});

test('премия без размера — не считается содержательной записью (surveyHasSubstance)', () => {
  const res = build({
    surveys: [survey({ pay_from: 0, pay_to: 0, benefits: '', bonuses: JSON.stringify([{ type: 'KPI', size: '', per: '' }]) })]
  });
  const tsex1 = res.units.find(u => u.unit === 'Цех 1');
  assert.equal(tsex1.positionsDecided, 0);
});

test('премия с размером считается — даже без оклада', () => {
  const res = build({
    surveys: [survey({ pay_from: 0, pay_to: 0, bonuses: JSON.stringify([{ type: 'KPI', size: '10%', per: 'в месяц' }]) })]
  });
  const tsex1 = res.units.find(u => u.unit === 'Цех 1');
  assert.equal(tsex1.positionsDecided, 1);
});

// ── Люди ─────────────────────────────────────────────────────────────────────

test('человек, назначенный на подразделение через users.units, получает его охват', () => {
  const res = build({ surveys: [survey({ unit: 'Цех 2' })] }); // не решает ничего в Цехе 2 (нет такой должности «Токарь»)
  const sidorov = res.people.find(p => p.login === 'sidorov');
  assert.deepEqual(sidorov.units, ['Цех 2']);
  assert.equal(sidorov.positionsTotal, 1);
});

test('человек, назначенный и через resp/head, и через users.units того же юнита — не задвоен', () => {
  const usersWithBoth = users.map(u => u.login === 'ivanov' ? { ...u, units: 'Цех 1' } : u);
  const res = build({ users: usersWithBoth });
  const ivanov = res.people.find(p => p.login === 'ivanov');
  assert.deepEqual(ivanov.units, ['Цех 1']);
  assert.equal(ivanov.positionsTotal, 2); // не 4
});

test('человек без единиц в охвате (не resp/head и не назначен) не попадает в people', () => {
  const res = build();
  assert.equal(res.people.find(p => p.login === 'nobody'), undefined);
});

test('hasTelegram — по наличию telegram_chat_id', () => {
  const res = build();
  const ivanov = res.people.find(p => p.login === 'ivanov');
  const sidorov = res.people.find(p => p.login === 'sidorov');
  assert.equal(ivanov.hasTelegram, true);
  assert.equal(sidorov.hasTelegram, false);
});

// ── Лента ────────────────────────────────────────────────────────────────────

test('лента отсортирована по дате, новые сверху, обрезана до 30', () => {
  const many = Array.from({ length: 35 }, (_, i) =>
    survey({ unit: 'Цех 1', created_at: `2026-08-01 10:${String(i).padStart(2, '0')}:00` }));
  const res = build({ surveys: many });
  assert.equal(res.feed.length, 30);
  // Убывающий порядок по дате — новые записи сверху.
  for (let i = 1; i < res.feed.length; i++) {
    assert.ok(res.feed[i - 1].at >= res.feed[i].at);
  }
});

// ── Область видимости ────────────────────────────────────────────────────────

test('HR BP видит только свои направления — и в units, и в people, и в feed', () => {
  // myHrbpUnits — то, что в контроллере даёт unitsForUser(user.id, 'hrbp')
  // (division_assignments), здесь передаём напрямую как чистую функцию.
  const filter = unitScopeFilter({ role: 'hrbp' }, new Set(['Цех 1', 'Цех 2']));
  const res = build({ surveys: [survey({ unit: 'Цех 3' })] }, filter);
  assert.deepEqual(res.units.map(u => u.unit).sort(), ['Цех 1', 'Цех 2']);
  assert.equal(res.people.some(p => p.login === 'sidorov'), true);
  assert.equal(res.feed.length, 0); // запись в Цехе 3 — вне видимости этого HR BP
});

test('admin/cb видят все направления (unitFilter = null)', () => {
  const res = build({}, null);
  assert.equal(res.units.length, 4);
});
