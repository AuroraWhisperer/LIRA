'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createRemoteGiftCursorStore,
  createRemoteGiftSourceKey,
} = require('../src/electron/remote-gift-cursor-store');

test('remote gift cursor store atomically keeps only the matching source cursor', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-cursor-'));
  const store = createRemoteGiftCursorStore({ dataDir });
  const sourceA = createRemoteGiftSourceKey(
    'https://api.example.test',
    { accountName: 'alice', subdomain: 'alice' },
    { id: 'device-a' },
  );
  const sourceB = createRemoteGiftSourceKey(
    'https://api.example.test',
    { accountName: 'bob', subdomain: 'bob' },
    { id: 'device-b' },
  );

  try {
    assert.equal(store.load(sourceA), null);
    assert.equal(store.save(sourceA, 42), 42);
    assert.equal(store.load(sourceA), 42);
    assert.equal(store.load(sourceB), null);
    assert.deepEqual(
      fs.readdirSync(dataDir).filter((name) => name.includes('.tmp-')),
      [],
    );

    fs.writeFileSync(store.filePath, '{broken', 'utf8');
    assert.equal(store.load(sourceA), null);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('remote gift source key is tenant-specific without storing tenant text', () => {
  const alice = createRemoteGiftSourceKey(
    'https://api.example.test/',
    { accountName: 'Alice', subdomain: 'Alice' },
    { id: 'device-a' },
  );
  const bob = createRemoteGiftSourceKey(
    'https://api.example.test',
    { accountName: 'Bob', subdomain: 'Bob' },
    { id: 'device-b' },
  );
  assert.match(alice, /^[a-f0-9]{64}$/u);
  assert.notEqual(alice, bob);
  assert.equal(alice.includes('alice'), false);
  assert.throws(
    () => createRemoteGiftSourceKey('https://api.example.test'),
    /REMOTE_GIFT_SOURCE_UNAVAILABLE/,
  );
});

test('remote gift source key uses only canonical origin and immutable account', () => {
  const expected = createRemoteGiftSourceKey(
    'https://api.example.test',
    { accountName: 'alice', subdomain: 'old-subdomain' },
    { id: 'old-device' },
  );
  assert.equal(
    createRemoteGiftSourceKey(
      'HTTPS://API.EXAMPLE.TEST:443/',
      { accountName: 'ALICE', subdomain: 'new-subdomain' },
      { id: 'new-device' },
    ),
    expected,
  );
  assert.notEqual(
    createRemoteGiftSourceKey('https://other.example.test', {
      accountName: 'alice',
    }),
    expected,
  );
  for (const invalidUrl of [
    'http://127.0.0.1:13000',
    'http://localhost:13000',
    'http://api.example.test',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]',
    'https://bad_host.example',
    'https://user@api.example.test',
    'https://api.example.test/path',
    'https://api.example.test/?token=secret',
    'https://api.example.test/#fragment',
  ]) {
    assert.throws(
      () =>
        createRemoteGiftSourceKey(invalidUrl, {
          accountName: 'alice',
        }),
      /INVALID_GIFT_SOURCE_ORIGIN/,
    );
  }
});
