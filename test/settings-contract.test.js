'use strict';

const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { createSettingsStore, DEFAULT_SETTINGS } = require('../src/storage/settings-store');
const { routes } = require('../src/server/routes/settings-routes');

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  const store = createSettingsStore(db);
  const dirtyScopes = [];
  const context = {
    settings: {
      defaults: DEFAULT_SETTINGS,
      get: store.getSettings,
      set: store.setSetting,
      setMany: (values) => store.setSettings(values),
    },
    bilibili: { configure() {} },
    broadcastSnapshot() {},
    cloudSync: { request: (scope) => dirtyScopes.push(scope) },
    system: { getState: () => ({ settings: store.getSettings() }) },
  };
  async function post(body) {
    const response = {
      writeHead(status) { this.status = status; },
      end(text) { this.payload = JSON.parse(text); },
    };
    await routes['POST /api/settings'](context, { body: async () => body }, response);
    return response;
  }
  return { db, store, dirtyScopes, post };
}

test('invalid setting batches do not commit earlier valid fields', async (t) => {
  const f = fixture(t);
  const result = await f.post({ paused: true, danmakuFullscreenDurationSeconds: 1 });
  assert.equal(result.status, 400);
  assert.equal(f.store.getSettings().paused, 'false');
  assert.deepEqual(f.dirtyScopes, []);
});

test('only changed synchronized settings request a cloud upload', async (t) => {
  const f = fixture(t);
  assert.equal((await f.post({ themeOpacity: '0.8' })).status, 200);
  assert.deepEqual(f.dirtyScopes, []);
  await f.post({ paused: 'false' });
  assert.deepEqual(f.dirtyScopes, []);
  await f.post({ paused: true });
  assert.deepEqual(f.dirtyScopes, ['settings']);
});

test('local settings enforce synchronized integer and boolean contracts', async (t) => {
  const f = fixture(t);
  for (const body of [
    { queueLimit: 0 }, { queueLimit: 301 }, { queueLimit: 1.5 },
    { userCooldownSeconds: -1 }, { userCooldownSeconds: 3601 },
    { paused: 'sometimes' },
  ]) assert.equal((await f.post(body)).status, 400, JSON.stringify(body));
  assert.equal((await f.post({ queueLimit: '300', userCooldownSeconds: 3600, paused: 1 })).status, 200);
  assert.equal(f.store.getSettings().paused, 'true');
});

test('settings store rolls back a failed batch without invalidating the cached state', (t) => {
  const f = fixture(t);
  const before = f.store.getSettings();
  f.db.exec("CREATE TRIGGER fail_theme BEFORE UPDATE ON settings WHEN NEW.key = 'themeOpacity' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  assert.throws(() => f.store.setSettings({ paused: 'true', themeOpacity: '0.8' }), /fixture failure/);
  assert.deepEqual(f.store.getSettings(), before);
  assert.equal(f.db.prepare("SELECT value FROM settings WHERE key = 'paused'").get().value, 'false');
});
