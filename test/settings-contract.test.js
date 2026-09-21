'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const {
  createSettingsStore,
  DEFAULT_SETTINGS,
} = require('../src/storage/settings-store');
const { routes } = require('../src/server/routes/settings-routes');
const { createWeSingCapture } = require('../src/music/wesing-capture');

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(
    'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)',
  );
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
      writeHead(status) {
        this.status = status;
      },
      end(text) {
        this.payload = JSON.parse(text);
      },
    };
    await routes['POST /api/settings'](
      context,
      { body: async () => body },
      response,
    );
    return response;
  }
  return { db, store, context, dirtyScopes, post };
}

test('invalid setting batches do not commit earlier valid fields', async (t) => {
  const f = fixture(t);
  const result = await f.post({
    paused: true,
    danmakuFullscreenDurationSeconds: 1,
  });
  assert.equal(result.status, 400);
  assert.equal(f.store.getSettings().paused, 'false');
  assert.deepEqual(f.dirtyScopes, []);
});

test('interaction appearance persists, preserves saved values on reinitialization and rejects invalid batches atomically', async (t) => {
  const f = fixture(t);
  assert.equal(f.store.getSettings().interactionBackgroundOpacity, '100');
  const result = await f.post({
    interactionOverlayTitle: '  今晚唱什么  ', interactionBarColor: '#CDEFEA', interactionBackgroundOpacity: 0,
    interactionRatingRules: '弹幕评分\r\n仅发整数\n\n取最后一次', interactionOverallOpacity: 65,
    interactionFontSize: 24, interactionCornerRadius: 0, interactionShowStatus: false, interactionShowParticipants: 'false',
  });
  assert.equal(result.status, 200);
  const reloaded = createSettingsStore(f.db).getSettings();
  assert.equal(reloaded.interactionOverlayTitle, '今晚唱什么');
  assert.equal(reloaded.interactionBarColor, '#cdefea');
  assert.equal(reloaded.interactionBackgroundOpacity, '0');
  assert.equal(reloaded.interactionRatingRules, '弹幕评分\n仅发整数\n\n取最后一次');
  assert.equal(reloaded.interactionOverallOpacity, '65');
  assert.equal(reloaded.interactionFontSize, '24');
  assert.equal(reloaded.interactionCornerRadius, '0');
  assert.equal(reloaded.interactionShowStatus, 'false');
  assert.equal(reloaded.interactionShowParticipants, 'false');
  for (const invalid of [
    { interactionBarColor: 'red' }, { interactionBackgroundOpacity: 101 }, { interactionOverlayHint: '长'.repeat(81) },
    { interactionRatingRules: ['非法类型'] }, { interactionOverallOpacity: -1 }, { interactionFontSize: 25 },
    { interactionCornerRadius: 33 }, { interactionShowStatus: 'yes' }, { interactionShowParticipants: 1 },
  ]) {
    assert.equal((await f.post({ interactionOverlayTitle: '不得保存', ...invalid })).status, 400);
    assert.equal(f.store.getSettings().interactionOverlayTitle, '今晚唱什么');
  }
  assert.deepEqual(f.dirtyScopes, []);
  assert.equal((await f.post({ interactionOverlayTitle: '', interactionRatingRules: '' })).status, 200);
  assert.equal(createSettingsStore(f.db).getSettings().interactionOverlayTitle, '');
  assert.equal(createSettingsStore(f.db).getSettings().interactionRatingRules, '');
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
    { queueLimit: 0 },
    { queueLimit: 301 },
    { queueLimit: 1.5 },
    { userCooldownSeconds: -1 },
    { userCooldownSeconds: 3601 },
    { queueLimit: [50] },
    { userCooldownSeconds: null },
    { userCooldownSeconds: [] },
    { userCooldownSeconds: false },
    { queueLimit: '1e2' },
    { queueLimit: '0x32' },
    { queueLimit: '50.0' },
    { paused: 'sometimes' },
  ])
    assert.equal((await f.post(body)).status, 400, JSON.stringify(body));
  assert.equal(
    (await f.post({ queueLimit: '300', userCooldownSeconds: 3600, paused: 1 }))
      .status,
    200,
  );
  assert.equal(f.store.getSettings().paused, 'true');
  assert.equal((await f.post({ queueLimit: ' 050 ', userCooldownSeconds: '00' })).status, 200);
});

test('settings store rolls back a failed batch without invalidating the cached state', (t) => {
  const f = fixture(t);
  const before = f.store.getSettings();
  f.db.exec(
    "CREATE TRIGGER fail_theme BEFORE UPDATE ON settings WHEN NEW.key = 'themeOpacity' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
  );
  assert.throws(
    () => f.store.setSettings({ paused: 'true', themeOpacity: '0.8' }),
    /fixture failure/,
  );
  assert.deepEqual(f.store.getSettings(), before);
  assert.equal(
    f.db.prepare("SELECT value FROM settings WHERE key = 'paused'").get().value,
    'false',
  );
});

test('invalid WeSing settings do not commit other fields in a batch', async (t) => {
  const f = fixture(t);
  for (const values of [
    { weSingCachePath: 'relative/WeSingCache' },
    { weSingCachePath: path.join(os.tmpdir(), 'wrong-name') },
    { weSingLyricOffsetMs: 3001 },
    { weSingLyricOffsetMs: 'invalid-offset' },
  ]) {
    const before = f.store.getSettings();
    const response = await f.post({ paused: true, ...values });
    assert.equal(response.status, 400);
    assert.deepEqual(f.store.getSettings(), before);
    assert.deepEqual(f.dirtyScopes, []);
  }
});

test('failed settings transactions do not apply prepared WeSing configuration', async (t) => {
  const f = fixture(t);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-wesing-settings-'));
  const previousCachePath = path.join(root, 'previous', 'WeSingCache');
  f.store.setSettings({ weSingCachePath: previousCachePath, weSingLyricOffsetMs: '0' });
  const capture = createWeSingCapture({ cachePath: previousCachePath, platform: 'win32' });
  t.after(() => {
    capture.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });
  f.context.weSing = { prepareConfiguration: capture.prepareConfiguration };
  f.db.exec(
    "CREATE TRIGGER fail_wesing BEFORE UPDATE ON settings WHEN NEW.key = 'weSingLyricOffsetMs' BEGIN SELECT RAISE(ABORT, 'fixture setting failure'); END",
  );
  const before = f.store.getSettings();
  await assert.rejects(f.post({
    weSingCachePath: path.join(root, 'next', 'WeSingCache'),
    weSingLyricOffsetMs: 250,
    paused: true,
  }), /fixture setting failure/);
  assert.deepEqual(f.store.getSettings(), before);
  assert.equal(capture.getStatus().cachePath, previousCachePath);
  assert.equal(capture.getStatus().lyricOffsetMs, 0);
  assert.deepEqual(f.dirtyScopes, []);
});
