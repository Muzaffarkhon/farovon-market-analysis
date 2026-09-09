'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getAccessibleDivisions } = require('../src/controllers/adminController');

test('getAccessibleDivisions: dir_head видит все подразделения своего направления', () => {
  const allDivs = [
    { unit: 'Управление муки', dir: 'Департамент муки', head: 'Иванов И.И.' },
    { unit: 'Мельница 1', dir: 'Департамент муки', parent_unit: 'Управление муки', head: 'Петров П.П.' },
    { unit: 'Мельница 2', dir: 'Департамент муки', parent_unit: 'Управление муки', head: 'Сидоров С.С.' },
    { unit: 'Комбикормовый цех', dir: 'Департамент кормов', head: 'Алиев А.А.' }
  ];

  const user = { fio: 'Иванов И.И.', role: 'dir_head', units: ['Департамент муки'] };
  const accessible = getAccessibleDivisions(user, allDivs);

  assert.equal(accessible.length, 3);
  assert.deepEqual(accessible.map(d => d.unit).sort(), ['Мельница 1', 'Мельница 2', 'Управление муки']);
});

test('getAccessibleDivisions: head видит свой отдел и подотделы каскадно через parent_unit', () => {
  const allDivs = [
    { unit: 'Транспортный отдел', dir: 'АХУ', head: 'Рахимов Д.Н.' },
    { unit: 'Служебный транспорт Анхор', dir: 'АХУ', parent_unit: 'Транспортный отдел', head: 'Рахимов Д.Н.' },
    { unit: 'Служебный транспорт Навобод', dir: 'АХУ', parent_unit: 'Транспортный отдел', head: 'Рахимов Д.Н.' },
    { unit: 'Хозяйственная служба', dir: 'АХУ', head: 'Бобочонов Н.О.' },
    { unit: 'Аварийная группа', dir: 'АХУ', parent_unit: 'Хозяйственная служба', head: 'Бобочонов Н.О.' }
  ];

  const user = { fio: 'Рахимов Д.Н.', role: 'head', units: ['Транспортный отдел'] };
  const accessible = getAccessibleDivisions(user, allDivs);

  assert.equal(accessible.length, 3);
  assert.deepEqual(accessible.map(d => d.unit).sort(), [
    'Служебный транспорт Анхор',
    'Служебный транспорт Навобод',
    'Транспортный отдел'
  ]);
});

test('getAccessibleDivisions: head без подразделений не видит чужие ветки', () => {
  const allDivs = [
    { unit: 'Транспортный отдел', dir: 'АХУ', head: 'Рахимов Д.Н.' },
    { unit: 'Хозяйственная служба', dir: 'АХУ', head: 'Бобочонов Н.О.' }
  ];

  const user = { fio: 'Неизвестный Н.Н.', role: 'head', units: [] };
  const accessible = getAccessibleDivisions(user, allDivs);

  assert.equal(accessible.length, 0);
});
