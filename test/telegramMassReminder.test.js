'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { selectReminderCandidates } = require('../src/services/telegramService');

// units/people — та же форма, что отдаёт coordinationService.getCoordination()
// (см. buildCoordination) — здесь собраны напрямую, без обращения к базе.
const units = [
  { unit: 'Цех 1', positionsTotal: 2, positionsDecided: 0 }, // не закрыт
  { unit: 'Цех 2', positionsTotal: 1, positionsDecided: 1 }, // закрыт полностью
  { unit: 'Склад', positionsTotal: 0, positionsDecided: 0 } // штатки нет вовсе
];

test('человек без Telegram — не кандидат, даже если есть незакрытое', () => {
  const people = [
    { login: 'sidorov', fio: 'Сидоров', units: ['Цех 1'], hasTelegram: false }
  ];
  assert.deepEqual(selectReminderCandidates({ units, people }), []);
});

test('у человека всё закрыто — не кандидат', () => {
  const people = [
    { login: 'petrov', fio: 'Петров', units: ['Цех 2'], hasTelegram: true }
  ];
  assert.deepEqual(selectReminderCandidates({ units, people }), []);
});

test('подразделение без штатки не считается незакрытым', () => {
  const people = [
    { login: 'sklad', fio: 'Кладовщик', units: ['Склад'], hasTelegram: true }
  ];
  assert.deepEqual(selectReminderCandidates({ units, people }), []);
});

test('есть Telegram и реально незакрытое — кандидат', () => {
  const people = [
    { login: 'ivanov', fio: 'Иванов', units: ['Цех 1'], hasTelegram: true }
  ];
  const res = selectReminderCandidates({ units, people });
  assert.equal(res.length, 1);
  assert.equal(res[0].login, 'ivanov');
});

test('хотя бы одно из нескольких подразделений незакрыто — кандидат', () => {
  const people = [
    { login: 'both', fio: 'И там, и там', units: ['Цех 2', 'Цех 1'], hasTelegram: true }
  ];
  const res = selectReminderCandidates({ units, people });
  assert.equal(res.length, 1);
});

test('смешанный список — фильтрует ровно тех, кому есть смысл писать', () => {
  const people = [
    { login: 'a', fio: 'A', units: ['Цех 1'], hasTelegram: true }, // кандидат
    { login: 'b', fio: 'B', units: ['Цех 1'], hasTelegram: false }, // нет Telegram
    { login: 'c', fio: 'C', units: ['Цех 2'], hasTelegram: true }, // всё закрыто
    { login: 'd', fio: 'D', units: ['Склад'], hasTelegram: true } // нет штатки
  ];
  const res = selectReminderCandidates({ units, people });
  assert.deepEqual(res.map(p => p.login), ['a']);
});
