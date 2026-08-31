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
