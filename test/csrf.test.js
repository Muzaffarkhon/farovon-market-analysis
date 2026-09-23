'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { csrfProtect } = require('../src/middleware/csrf');

function mockReq(over = {}) {
  return { method: 'POST', headers: {}, ...over };
}
function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('GET пропускается без проверки', () => {
  const req = mockReq({ method: 'GET' });
  const res = mockRes();
  let called = false;
  csrfProtect(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(res.statusCode, null);
});

test('POST с заголовком Authorization пропускается (не кука)', () => {
  const req = mockReq({ headers: { authorization: 'Bearer xyz' } });
  const res = mockRes();
  let called = false;
  csrfProtect(req, res, () => { called = true; });
  assert.equal(called, true);
});

test('POST с заголовком X-Token тоже пропускается', () => {
  const req = mockReq({ headers: { 'x-token': 'xyz' } });
  const res = mockRes();
  let called = false;
  csrfProtect(req, res, () => { called = true; });
  assert.equal(called, true);
});

test('POST по куке без токена — 403', () => {
  const req = mockReq({ headers: { cookie: 'farovon_session=abc' } });
  const res = mockRes();
  let called = false;
  csrfProtect(req, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
});

test('POST по куке с несовпадающим токеном — 403', () => {
  const req = mockReq({ headers: { cookie: 'farovon_session=abc; farovon_csrf=aaa', 'x-csrf-token': 'bbb' } });
  const res = mockRes();
  let called = false;
  csrfProtect(req, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
});

test('POST по куке с совпадающим токеном — пропускается', () => {
  const req = mockReq({ headers: { cookie: 'farovon_session=abc; farovon_csrf=matching-token', 'x-csrf-token': 'matching-token' } });
  const res = mockRes();
  let called = false;
  csrfProtect(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(res.statusCode, null);
});

test('PUT/PATCH/DELETE тоже проверяются, как POST', () => {
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const req = mockReq({ method, headers: { cookie: 'farovon_session=abc' } });
    const res = mockRes();
    let called = false;
    csrfProtect(req, res, () => { called = true; });
    assert.equal(called, false, method + ' должен требовать токен');
    assert.equal(res.statusCode, 403);
  }
});
