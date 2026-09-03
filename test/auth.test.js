'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const crypto = require('node:crypto');
const { passwordPolicyError, verifyPassword } = require('../src/controllers/authController');

test('passwordPolicyError: слишком короткий', () => {
  assert.match(passwordPolicyError('ab1'), /8 символов/);
});

test('passwordPolicyError: без цифры', () => {
  assert.match(passwordPolicyError('onlyletters'), /букву и одну цифру/);
});

test('passwordPolicyError: без буквы', () => {
  assert.match(passwordPolicyError('12345678'), /букву и одну цифру/);
});

test('passwordPolicyError: валидный пароль → null', () => {
  assert.equal(passwordPolicyError('Parol1234'), null);
  assert.equal(passwordPolicyError('пароль2026'), null);
});

test('verifyPassword: bcrypt-хэш', () => {
  const user = { password_hash: bcrypt.hashSync('secret123', 10) };
  assert.equal(verifyPassword('secret123', user), true);
  assert.equal(verifyPassword('wrong', user), false);
});

test('verifyPassword: нет пользователя / нет хэша', () => {
  assert.equal(verifyPassword('x', null), false);
  assert.equal(verifyPassword('x', {}), false);
});

test('verifyPassword: легаси несолёный SHA-256 всё ещё принимается (Finding 41)', () => {
  // Эта ветка ДОЛЖНА работать, пока прод-хэши не мигрируют на bcrypt при входе.
  const sha = crypto.createHash('sha256').update('legacyPass1').digest('hex');
  assert.equal(verifyPassword('legacyPass1', { password_hash: sha }), true);
  assert.equal(verifyPassword('wrong', { password_hash: sha }), false);
});
