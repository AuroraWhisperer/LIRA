'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const authorized = (name) => ({ state: 'authorized', streamer: {
  accountName: name, songPageUrl: `https://${name}.example.test/songs`,
} });

test('account observers share initialization and reject a late initial snapshot after an account change', async () => {
  const initial = Promise.withResolvers();
  let readCount = 0;
  let subscribeCount = 0;
  let stopCount = 0;
  let emit;
  let pagehide;
  const api = await loadModuleExports(path.resolve(__dirname, '../../public/js/admin/authorized-account.js'), {
    window: {
      liraLicense: {
        getState() { readCount += 1; return initial.promise; },
        onStateChanged(callback) { subscribeCount += 1; emit = callback; return () => { stopCount += 1; }; },
      },
      addEventListener(type, callback) { if (type === 'pagehide') pagehide = callback; },
    },
  });
  const first = [];
  const second = [];
  const stop = api.observeAuthorizedAccount(value => first.push(value));
  api.observeAuthorizedAccount(value => second.push(value));
  emit(authorized('second'));
  initial.resolve(authorized('first'));
  await api.waitForAuthorizedAccountInitialization();
  assert.deepEqual(first, ['', JSON.stringify(['second', 'https://second.example.test/songs'])]);
  assert.deepEqual(second, first);
  assert.equal(readCount, 1);
  assert.equal(subscribeCount, 1);

  emit({ ...authorized('second'), accessTokenExpiresAt: 12345 });
  assert.equal(first.length, 2, 'token renewal does not reset drafts');
  stop();
  emit({ state: 'unauthorized' });
  assert.equal(first.length, 2);
  assert.equal(second.at(-1), '');
  emit(authorized('second'));
  assert.equal(second.length, 4, 'logging in again reinitializes the UI');
  pagehide();
  emit(authorized('third'));
  assert.equal(stopCount, 1);
  assert.equal(second.length, 4);
});
