'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { suggestAdjacentGroups, splitRoleAndPoint, detectRegion } = require('../src/services/adjacentGroups');

test('splitRoleAndPoint: отрезает код и хвостовую «точку», роль оставляет', () => {
  const r = splitRoleAndPoint('0101 Хозяйственная служба Анхор 3');
  assert.equal(r.role, 'Хозяйственная служба');
  assert.equal(r.point, 'Анхор 3');
});

test('splitRoleAndPoint: строчные смысловые слова не режет', () => {
  const r = splitRoleAndPoint('Отдел оптовых продаж масла');
  assert.equal(r.role, 'Отдел оптовых продаж масла');
  assert.equal(r.point, '');
});

test('detectRegion: узнаёт город в хвосте названия', () => {
  assert.equal(detectRegion('0102 Склад Душанбе'), 'Душанбе');
  assert.equal(detectRegion('Склад без города'), '');
});

test('suggestAdjacentGroups: предлагает группу при ≥2 площадках и ≥2 различителях', () => {
  const divs = [
    { unit: '0101 Служба охраны Анхор', dir: 'Безопасность' },
    { unit: '0102 Служба охраны ТМК', dir: 'Безопасность' },
    { unit: '0103 Служба охраны Навобод', dir: 'Безопасность' }
  ];
  const groups = suggestAdjacentGroups(divs);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].units.length, 3);
});

test('suggestAdjacentGroups: одиночку не предлагает', () => {
  const divs = [{ unit: '0101 Служба охраны Анхор', dir: 'Безопасность' }];
  assert.equal(suggestAdjacentGroups(divs).length, 0);
});

test('suggestAdjacentGroups: подразделение с ручным group_key не трогает', () => {
  const divs = [
    { unit: '0101 Служба охраны Анхор', dir: 'Безопасность', group_key: 'охрана' },
    { unit: '0102 Служба охраны ТМК', dir: 'Безопасность', group_key: 'охрана' }
  ];
  assert.equal(suggestAdjacentGroups(divs).length, 0);
});

test('suggestAdjacentGroups: родительский узел (код на 00) исключён', () => {
  const divs = [
    { unit: '0100 Служба охраны Филиал', dir: 'Безопасность' },
    { unit: '0101 Служба охраны Анхор', dir: 'Безопасность' },
    { unit: '0102 Служба охраны ТМК', dir: 'Безопасность' }
  ];
  const groups = suggestAdjacentGroups(divs);
  assert.equal(groups.length, 1);
  assert.ok(!groups[0].units.some(u => u.unit.includes('0100')));
});
