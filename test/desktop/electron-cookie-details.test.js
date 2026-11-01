'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toSerializableCookie, toElectronCookieDetails } = require('../../src/electron/cookie-details');

test('cookie snapshots retain the existing allowlisted fields without mutating input', () => {
  const cookie = Object.freeze({
    name: 'synthetic',
    value: 'test-only',
    domain: '.example.test',
    path: '/login',
    secure: true,
    httpOnly: true,
    expirationDate: 123456,
    sameSite: 'strict',
    hostOnly: false,
    session: false,
  });
  assert.deepEqual(toSerializableCookie(cookie), {
    name: 'synthetic',
    value: 'test-only',
    domain: '.example.test',
    path: '/login',
    secure: true,
    httpOnly: true,
    expirationDate: 123456,
  });
  assert.deepEqual(toElectronCookieDetails(cookie), {
    url: 'https://example.test/login',
    name: 'synthetic',
    value: 'test-only',
    domain: '.example.test',
    path: '/login',
    secure: true,
    httpOnly: true,
    expirationDate: 123456,
  });
});

test('cookie restoration preserves protocol, default path and finite expiry coercion', () => {
  const base = { name: 'synthetic', value: '', domain: 'example.test' };
  for (const [secure, expectedSecure, protocol] of [
    [true, true, 'https'], [false, false, 'http'], [undefined, false, 'https'],
  ]) {
    const snapshot = toSerializableCookie({ ...base, secure });
    assert.equal(snapshot.path, '/');
    assert.equal(snapshot.secure, expectedSecure);
    const details = toElectronCookieDetails({ ...base, secure });
    assert.equal(details.url, `${protocol}://example.test/`);
    assert.equal(details.secure, expectedSecure);
  }
  for (const [expirationDate, expected] of [
    [undefined, undefined], ['invalid', undefined], [0, 0], ['123', 123],
  ]) {
    const details = toElectronCookieDetails({ ...base, expirationDate });
    assert.equal(Object.hasOwn(details, 'expirationDate'), expected !== undefined);
    assert.equal(details.expirationDate, expected);
  }
});
