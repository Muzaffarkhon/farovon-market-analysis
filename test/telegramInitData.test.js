'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { verifyInitData } = require('../src/services/telegramService');

const BOT_TOKEN = 'test-bot-token-123';

function buildInitData(fields, botToken = BOT_TOKEN) {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

function freshFields(over = {}) {
  return {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 555555, first_name: 'Тест' }),
    ...over
  };
}

test('verifyInitData: валидная подпись проходит и отдаёт user', () => {
  const initData = buildInitData(freshFields());
  const user = verifyInitData(initData, BOT_TOKEN);
  assert.ok(user);
  assert.equal(user.id, 555555);
});

test('verifyInitData: тронутое поле после подписи — отклонено', () => {
  const initData = buildInitData(freshFields());
  // Подменяем id пользователя в уже подписанной строке, не трогая hash —
  // ровно то, что должна ловить проверка подписи.
  const tampered = initData.replace('%22id%22%3A555555', '%22id%22%3A1');
  assert.notEqual(tampered, initData);
  assert.equal(verifyInitData(tampered, BOT_TOKEN), null);
});

test('verifyInitData: просроченный auth_date — отклонено', () => {
  const oldDate = Math.floor(Date.now() / 1000) - 90000; // >24ч
  const initData = buildInitData(freshFields({ auth_date: String(oldDate) }));
  assert.equal(verifyInitData(initData, BOT_TOKEN), null);
});

test('verifyInitData: нет hash — отклонено', () => {
  const params = new URLSearchParams(freshFields());
  assert.equal(verifyInitData(params.toString(), BOT_TOKEN), null);
});

test('verifyInitData: подпись другим токеном — отклонено', () => {
  const initData = buildInitData(freshFields(), 'другой-токен');
  assert.equal(verifyInitData(initData, BOT_TOKEN), null);
});

test('verifyInitData: пусто или нет токена — отклонено', () => {
  assert.equal(verifyInitData('', BOT_TOKEN), null);
  assert.equal(verifyInitData(buildInitData(freshFields()), ''), null);
});
