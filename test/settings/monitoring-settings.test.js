'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createSettingsStore, DEFAULT_SETTINGS } = require('../../src/storage/settings-store');
const {
  normalizeSettingsPatch, normalizeCloudSettingsSnapshot, serializeCloudSettings, hasCloudSettingChanges,
} = require('../../src/server/settings-contract');

function fixture(t, legacy) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  if (legacy !== undefined) {
    db.prepare('INSERT INTO settings VALUES (?, ?, ?)').run('enableBilibili', legacy, 'test');
  }
  return { db, store: createSettingsStore(db) };
}

test('monitoring defaults on and an explicit legacy stop survives initialization', (t) => {
  for (const legacy of [undefined, 'true', 'false']) {
    const { db, store } = fixture(t, legacy);
    assert.equal(store.getSettings().danmakuMonitoringEnabled, legacy ?? 'true');
    assert.equal(store.getSettings().giftMonitoringEnabled, legacy ?? 'true');
    store.setSetting('danmakuMonitoringEnabled', 'false');
    store.setSetting('giftMonitoringEnabled', 'true');
    const restarted = createSettingsStore(db).getSettings();
    assert.equal(restarted.danmakuMonitoringEnabled, 'false');
    assert.equal(restarted.giftMonitoringEnabled, 'true');
    assert.equal(restarted.enableBilibili, 'true');
  }
});

test('independent settings persist, synchronize and derive the legacy master switch', (t) => {
  const { store } = fixture(t);
  for (const [danmaku, gift] of [[false, true], [true, false], [false, false], [true, true]]) {
    const patch = normalizeSettingsPatch({ danmakuMonitoringEnabled: danmaku, giftMonitoringEnabled: gift }, DEFAULT_SETTINGS);
    const changed = store.setSettings(patch.values);
    assert.equal(hasCloudSettingChanges(changed), true);
    const cloud = serializeCloudSettings(store.getSettings());
    assert.equal(cloud.danmakuMonitoringEnabled, danmaku);
    assert.equal(cloud.giftMonitoringEnabled, gift);
    assert.equal(cloud.enableBilibili, danmaku || gift);
    assert.deepEqual(store.setSettings(normalizeCloudSettingsSnapshot(cloud)), []);
  }
});

test('legacy saves preserve split choices unless the master value changes', (t) => {
  const { store } = fixture(t);
  store.setSettings({ danmakuMonitoringEnabled: 'false' });
  store.setSettings({ enableBilibili: 'true', paused: 'true' });
  assert.equal(store.getSettings().danmakuMonitoringEnabled, 'false');
  store.setSetting('enableBilibili', 'false');
  assert.equal(store.getSettings().giftMonitoringEnabled, 'false');
  store.setSetting('enableBilibili', 'true');
  assert.equal(store.getSettings().danmakuMonitoringEnabled, 'true');
  // Explicit channel values win even when a stale legacy field accompanies them.
  store.setSettings({ enableBilibili: 'false', danmakuMonitoringEnabled: 'false', giftMonitoringEnabled: 'true' });
  assert.equal(store.getSettings().enableBilibili, 'true');
  const legacy = serializeCloudSettings(store.getSettings());
  delete legacy.danmakuMonitoringEnabled;
  delete legacy.giftMonitoringEnabled;
  store.setSettings(normalizeCloudSettingsSnapshot(legacy));
  assert.equal(store.getSettings().danmakuMonitoringEnabled, 'false');
});

test('initialization restores the combined mirror after a legacy client wrote it directly', (t) => {
  const { db, store } = fixture(t);
  store.setSettings({ danmakuMonitoringEnabled: 'false', giftMonitoringEnabled: 'false' });
  db.prepare("UPDATE settings SET value='true' WHERE key='enableBilibili'").run();
  const restarted = createSettingsStore(db).getSettings();
  assert.equal(restarted.enableBilibili, 'false');
  assert.equal(restarted.danmakuMonitoringEnabled, 'false');
  assert.equal(restarted.giftMonitoringEnabled, 'false');
});

test('invalid flags reject a complete patch or cloud response', (t) => {
  const { store } = fixture(t);
  for (const key of ['danmakuMonitoringEnabled', 'giftMonitoringEnabled']) {
    for (const invalid of ['yes', null, [], 2]) {
      const patch = normalizeSettingsPatch({ paused: true, [key]: invalid }, DEFAULT_SETTINGS);
      assert.ok(patch.error);
      assert.equal(patch.values, undefined);
      assert.throws(() => normalizeCloudSettingsSnapshot({ ...serializeCloudSettings(store.getSettings()), [key]: invalid }));
    }
  }
});

test('a failed channel batch rolls back both flags and the legacy mirror', (t) => {
  const { db, store } = fixture(t);
  db.exec(`CREATE TRIGGER reject_monitoring BEFORE UPDATE ON settings
    WHEN NEW.key = 'giftMonitoringEnabled' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`);
  assert.throws(() => store.setSetting('enableBilibili', 'false'), /synthetic failure/);
  const restarted = createSettingsStore(db).getSettings();
  assert.equal(restarted.enableBilibili, 'true');
  assert.equal(restarted.danmakuMonitoringEnabled, 'true');
  assert.equal(restarted.giftMonitoringEnabled, 'true');
});
