'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Свежий экземпляр модуля на каждый тест — у него общий Map на процесс.
function freshCache() {
  delete require.cache[require.resolve('../src/services/refCache')];
  return require('../src/services/refCache');
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
