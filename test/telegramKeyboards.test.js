'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('mainKeyboard: web_app-кнопка на https, url-кнопка на http', () => {
  const prevUrl = process.env.WEBAPP_URL;
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/controllers/telegramController')];

  process.env.WEBAPP_URL = 'https://farovon.example';
  let { mainKeyboard, PROGRESS_LABEL } = require('../src/controllers/telegramController');
  let kb = mainKeyboard().reply_markup.keyboard;
  assert.equal(kb.length, 2);
  assert.equal(kb[0][0].text, '🚀 Открыть систему');
  assert.deepEqual(kb[0][0].web_app, { url: 'https://farovon.example' });
  assert.equal(kb[0][0].url, undefined);
  assert.equal(kb[1][0].text, PROGRESS_LABEL);
  assert.equal(kb[1][1].text, '💬 Написать администратору');

  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/controllers/telegramController')];
  process.env.WEBAPP_URL = 'http://localhost:3000';
  ({ mainKeyboard } = require('../src/controllers/telegramController'));
  kb = mainKeyboard().reply_markup.keyboard;
  assert.equal(kb[0][0].url, 'http://localhost:3000');
  assert.equal(kb[0][0].web_app, undefined);

  if (prevUrl === undefined) delete process.env.WEBAPP_URL; else process.env.WEBAPP_URL = prevUrl;
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/controllers/telegramController')];
});

test('mainKeyboard: resize_keyboard включён, one_time отсутствует (постоянная, не одноразовая)', () => {
  const { mainKeyboard } = require('../src/controllers/telegramController');
  const rm = mainKeyboard().reply_markup;
  assert.equal(rm.resize_keyboard, true);
  assert.equal(rm.one_time_keyboard, undefined);
});
