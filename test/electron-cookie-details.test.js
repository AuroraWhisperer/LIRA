'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toSerializableCookie, toElectronCookieDetails } = require('../src/electron/cookie-details');

test('cookie snapshots retain the existing allowlisted fields without mutating input', () => {
  const cookie = Object.freeze({
    name: 'synthetic', value: 'test-only', domain: '.example.test', path: '/login',
    secure: true, httpOnly: true, expirationDate: 123456,
    sameSite: 'strict', hostOnly: false, session: false,
  });
  assert.deepEqual(toSerializableCookie(cookie), {
    name: 'synthetic', value: 'test-only', domain: '.example.test', path: '/login',
    secure: true, httpOnly: true, expirationDate: 123456,
  });
  assert.deepEqual(toElectronCookieDetails(cookie), {
    url: 'https://example.test/login',
    name: 'synthetic', value: 'test-only', domain: '.example.test', path: '/login',
    secure: true, httpOnly: true, expirationDate: 123456,
  });
});

test('cookie restoration preserves protocol, default path and finite expiry coercion', () => {
  for (const secure of [true, false, undefined, 'true']) {
    for (const expirationDate of [undefined, 'invalid', Infinity, 0, '123', null]) {
      const cookie = { name: 'synthetic', value: '', domain: 'example.test', secure, expirationDate };
      const snapshot = toSerializableCookie(cookie);
      assert.equal(snapshot.path, '/');
      assert.equal(snapshot.secure, secure === true);
      assert.equal(snapshot.httpOnly, false);
      const details = toElectronCookieDetails(cookie);
      assert.equal(details.url, `${secure === false ? 'http' : 'https'}://example.test/`);
      assert.equal(details.secure, secure === true);
      assert.equal(details.httpOnly, false);
      assert.equal(details.domain, cookie.domain);
      assert.equal(Object.hasOwn(details, 'expirationDate'), Number.isFinite(Number(expirationDate)));
      if (Object.hasOwn(details, 'expirationDate')) assert.equal(details.expirationDate, Number(expirationDate));
    }
  }
});
