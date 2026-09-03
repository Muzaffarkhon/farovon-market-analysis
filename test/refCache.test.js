'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Тот же экземпляр, что использует приложение (не мутируем require.cache —
// это ломало бы соседние suite'ы). Перед каждым тестом полный сброс.
const refCache = require('../src/services/refCache');
function freshCache() {
  refCache._resetForTests();
  return refCache;
}

test('cached: второй вызов с тем же ключом не зовёт loader', async () => {
  const { cached } = freshCache();
  let calls = 0;
  const load = async () => { calls++; return calls; };
  assert.equal(await cached('k', load), 1);
  assert.equal(await cached('k', load), 1);
  assert.equal(calls, 1);
});

test('cached: истёкший TTL перезагружает', async () => {
  const { cached } = freshCache();
  let calls = 0;
  const load = async () => { calls++; return calls; };
  await cached('k', load, 5);
  await new Promise(r => setTimeout(r, 12));
  assert.equal(await cached('k', load, 5), 2);
});

test('invalidate(key): сбрасывает только один ключ', async () => {
  const { cached, invalidate } = freshCache();
  let a = 0, b = 0;
  await cached('a', async () => ++a);
  await cached('b', async () => ++b);
  invalidate('a');
  await cached('a', async () => ++a);
  await cached('b', async () => ++b);
  assert.equal(a, 2);
  assert.equal(b, 1);
});

test('invalidate(): сбрасывает всё', async () => {
  const { cached, invalidate } = freshCache();
  let a = 0, b = 0;
  await cached('a', async () => ++a);
  await cached('b', async () => ++b);
  invalidate();
  await cached('a', async () => ++a);
  await cached('b', async () => ++b);
  assert.equal(a, 2);
  assert.equal(b, 2);
});

test('cached: параллельные промахи по одному ключу делят один loader (Finding 14)', async () => {
  const { cached } = freshCache();
  let calls = 0;
  const slow = () => new Promise(r => setTimeout(() => { calls++; r(calls); }, 20));
  const [x, y, z] = await Promise.all([cached('k', slow), cached('k', slow), cached('k', slow)]);
  assert.equal(calls, 1);
  assert.deepEqual([x, y, z], [1, 1, 1]);
});

// ─── Finding 45: предикат сброса кэша (относительный путь к /api) ───
test('touchesRefData: какие запросы сбрасывают кэш справочников', () => {
  const { touchesRefData } = freshCache();
  assert.equal(touchesRefData('POST', '/admin/divisions'), true);
  assert.equal(touchesRefData('POST', '/admin/period'), true);
  assert.equal(touchesRefData('POST', '/survey/dictionary/add'), true);
  assert.equal(touchesRefData('POST', '/survey/save'), true);        // survey_note + новые сегменты
  assert.equal(touchesRefData('POST', '/survey/save-details'), false); // только surveys
  assert.equal(touchesRefData('GET', '/admin/divisions'), false);     // чтение
  assert.equal(touchesRefData('POST', '/dashboard/extended'), false);
  assert.equal(touchesRefData('POST', '/auth/resume'), false);
  assert.equal(touchesRefData('POST', '/admin'), false);              // не /admin/ с слэшем
});
