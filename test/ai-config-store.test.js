'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../src/storage/schema');
const { createAiConfigStore } = require('../src/ai/config-store');

function createStore(options = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  const codec = {
    isAvailable: () => true,
    encrypt: (value) => Buffer.from(`encrypted:${value}`).toString('base64'),
    decrypt: (value) => Buffer.from(value, 'base64').toString().replace(/^encrypted:/, '')
  };
  return { db, store: createAiConfigStore(db, codec, options) };
}

test('AI config defaults are redacted and secrets are stored encrypted', () => {
  const { db, store } = createStore();
  const defaults = store.getPublicConfig();
  assert.equal(defaults.model, 'ds-v4-flash');
  assert.equal(defaults.deepseekResponsesUrl, '');
  assert.equal(defaults.hasDeepSeekApiKey, false);
  assert.equal('deepseekApiKey' in defaults, false);

  store.updateConfig({ deepseekApiKey: 'sk-secret-value', enabled: true });
  const row = db.prepare("SELECT value, is_secret FROM ai_configuration WHERE key = 'deepseekApiKey'").get();
  assert.equal(row.is_secret, 1);
  assert.doesNotMatch(row.value, /sk-secret-value/);
  assert.equal(store.getConfig().deepseekApiKey, 'sk-secret-value');
  assert.equal(store.getPublicConfig().hasDeepSeekApiKey, true);
});

test('AI config validates URLs and numeric stability limits', () => {
  const { store } = createStore();
  assert.throws(() => store.updateConfig({ deepseekResponsesUrl: 'javascript:alert(1)' }), /HTTP/);
  assert.throws(() => store.updateConfig({ generationConcurrency: 9 }), /1 到 5/);
  assert.throws(() => store.updateConfig({ sendIntervalMs: 10 }), /1500/);
  assert.throws(() => store.updateConfig({ replyMaxChars: 51 }), /10 到 50/);
});

test('AI context, cache and blacklist use TTL and bound keys', () => {
  let now = 1000;
  const { store } = createStore({ now: () => now });
  store.setContext('42', { city: '苏州' }, 10);
  store.setCache('weather 苏州', { text: '晴' }, 10);
  store.setBlacklist('42', true, { userName: 'Alice', reason: 'spam' });
  assert.deepEqual(store.getContext('42'), { city: '苏州' });
  assert.deepEqual(store.getCache('weather 苏州'), { text: '晴' });
  assert.equal(store.isBlacklisted('42'), true);
  now = 12000;
  assert.equal(store.getContext('42'), null);
  assert.equal(store.getCache('weather 苏州'), null);
  store.setBlacklist('42', false);
  assert.equal(store.isBlacklisted('42'), false);
});
