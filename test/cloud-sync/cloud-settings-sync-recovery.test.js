'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../../src/storage/schema');
const { createSettingsStore } = require('../../src/storage/settings-store');
const { normalizeCloudSettingsSnapshot, serializeCloudSettings } = require('../../src/server/settings-contract');
const { createFixture } = require('../helpers/cloud-sync-controller-fixture');

function fixture(t) {
  const root = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'settings-recovery-'));
  const file = path.join(directory, 'settings.sqlite');
  let db;
  let settings;
  let active;
  let identity = { accountName: 'first', streamerId: 1 };
  let upload = async () => {};
  const cloud = new Map();
  const uploads = [];
  const key = () => JSON.stringify(['https://api.example.test', identity.accountName, identity.streamerId]);
  function cloudState() {
    if (!cloud.has(key())) cloud.set(key(), {
      revision: 1,
      values: { ...serializeCloudSettings(settings.getDefaultSettings()), roomId: '123', queueLimit: 50,
        giftAutoThanksEnabled: false, giftStatsQueryEnabled: false },
    });
    return cloud.get(key());
  }
  function open() {
    db = new DatabaseSync(file);
    db.exec(SONG_SCHEMA);
    settings = createSettingsStore(db);
    active = createFixture({
      licenseManager: {
        getCloudSyncIdentity: () => identity,
        watchCloudStateChangesInternal: undefined,
        getCloudState: async () => ({
          settings: { initialized: true, ...cloudState() },
          songs: { initialized: true, revision: 1 },
          bilibili: { initialized: false, revision: 0 },
        }),
        async updateCloudSettings(values) {
          const account = key();
          const snapshot = { revision: cloudState().revision + 1, values: { ...cloudState().values, ...values } };
          uploads.push({ account, values: structuredClone(values) });
          await upload();
          cloud.set(account, snapshot);
          return snapshot;
        },
      },
      runtime: {
        prepareCloudRoomAccount: (account) => settings.prepareCloudRoomAccount(account),
        getCloudSettingsSnapshot: () => serializeCloudSettings(settings.getSettings()),
        applyCloudSettingsSnapshot: (values) => settings.setSettings(normalizeCloudSettingsSnapshot(values), { syncPending: false }),
        getPendingCloudSettings: (account) => {
          const pending = settings.getPendingCloudSettings?.(account);
          return pending ? { ...pending, values: serializeCloudSettings(pending.values) } : null;
        },
        acknowledgePendingCloudSettings: (account, mutationId) => settings.acknowledgePendingCloudSettings(account, mutationId),
      },
    });
  }
  open();
  t.after(async () => {
    active.controller.dispose();
    await active.controller.whenIdle();
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    get db() { return db; },
    get settings() { return settings; },
    get controller() { return active.controller; },
    key, cloud, uploads,
    setUpload(fn) { upload = fn; },
    edit(values, notify = true) {
      settings.setSettings(values);
      if (notify) active.emitLocal('settings');
    },
    async restart() {
      active.controller.dispose();
      await active.controller.whenIdle();
      db.close();
      open();
      return active.controller.start();
    },
    setAccount(accountName, streamerId) {
      identity = { accountName, streamerId };
      active.emitState('authorized');
    },
  };
}

test('unsent settings survive closing SQLite and restarting, then clear only after successful upload', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  f.setUpload(async () => { throw new Error('OFFLINE'); });
  f.edit({ queueLimit: '77' });
  await f.controller.whenIdle();
  await f.restart();
  assert.equal(f.settings.getSettings().queueLimit, '77');
  assert.equal(f.cloud.get(f.key()).values.queueLimit, 50);
  f.setUpload(async () => {});
  await f.controller.syncNow();
  assert.equal(f.cloud.get(f.key()).values.queueLimit, 77);
  assert.equal(f.settings.getPendingCloudSettings(f.key()), null);
  await f.restart();
  assert.equal(f.settings.getSettings().queueLimit, '77');
});

test('a committed setting is recovered even when the process stops before the dirty notification', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  f.edit({ queueLimit: '78' }, false);
  await f.restart();
  assert.equal(f.settings.getSettings().queueLimit, '78');
  assert.equal(f.cloud.get(f.key()).values.queueLimit, 78);
});

test('a late settings acknowledgement cannot overwrite or clear a newer committed edit', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  const pending = Promise.withResolvers();
  f.setUpload(() => pending.promise);
  f.edit({ queueLimit: '77' });
  await new Promise(setImmediate);
  f.edit({ queueLimit: '88' }, false);
  pending.resolve();
  await f.controller.whenIdle();
  assert.equal(f.settings.getSettings().queueLimit, '88');
  assert.equal(f.settings.getPendingCloudSettings(f.key()).values.queueLimit, '88');
  await f.controller.syncNow();
  assert.equal(f.cloud.get(f.key()).values.queueLimit, 88);
  assert.equal(f.settings.getPendingCloudSettings(f.key()), null);
});

test('pending settings stay with their owner across account switches and late responses', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  const firstKey = f.key();
  const pending = Promise.withResolvers();
  f.setUpload(() => pending.promise);
  f.edit({ roomId: '456', queueLimit: '77' });
  await new Promise(setImmediate);
  f.setAccount('second', 2);
  pending.resolve();
  await f.controller.whenIdle();
  assert.equal(f.settings.getSettings().queueLimit, '50');
  assert.equal(f.settings.getSettings().roomId, '123');
  assert.equal(f.settings.getPendingCloudSettings(firstKey).values.queueLimit, '77');
  assert.equal(f.settings.getPendingCloudSettings(f.key()), null);
  assert.ok(f.uploads.every((entry) => entry.account === firstKey));
  f.setAccount('first', 1);
  await f.controller.whenIdle();
  assert.equal(f.settings.getSettings().queueLimit, '77');
  assert.equal(f.settings.getSettings().roomId, '456');
  assert.equal(f.settings.getPendingCloudSettings(firstKey), null);
});

test('settings and their pending record roll back together when persistence fails', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  f.db.exec(`CREATE TRIGGER reject_pending BEFORE INSERT ON settings
    WHEN NEW.key LIKE 'cloudSettingsSyncPending:%'
    BEGIN SELECT RAISE(ABORT, 'pending write failed'); END;`);
  assert.throws(() => f.edit({ queueLimit: '77' }), /pending write failed/);
  assert.equal(f.settings.getSettings().queueLimit, '50');
  assert.equal(f.db.prepare('SELECT value FROM settings WHERE key = ?').get('queueLimit').value, '50');
  assert.equal(f.settings.getPendingCloudSettings(f.key()), null);
});

test('only owned local cloud settings create private pending records without cloud-apply echoes', async (t) => {
  const f = fixture(t);
  f.settings.setSettings({ queueLimit: '60' });
  await f.controller.start();
  assert.equal(f.settings.getPendingCloudSettings(f.key()), null);
  f.edit({ openingTitle: '本地标题' }, false);
  assert.equal(f.settings.getPendingCloudSettings(f.key()), null);
  f.settings.setSetting('paused', 'true');
  const pending = f.settings.getPendingCloudSettings(f.key());
  assert.equal(pending.values.paused, 'true');
  assert.equal(Object.hasOwn(pending.values, 'openingTitle'), false);
  assert.ok(Object.keys(f.settings.getSettings()).every((key) => !key.startsWith('cloudSettingsSyncPending:')));
  await f.controller.syncNow();
  assert.equal(f.settings.getPendingCloudSettings(f.key()), null);
  assert.equal(f.cloud.get(f.key()).values.paused, true);
});

test('successful gift interaction uploads acknowledge the included pending settings', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  f.edit({ queueLimit: '77' }, false);
  const result = await f.controller.setGiftInteraction({ key: 'giftAutoThanksEnabled', enabled: true });
  assert.equal(result.ok, true);
  assert.equal(f.cloud.get(f.key()).values.queueLimit, 77);
  assert.equal(f.settings.getPendingCloudSettings(f.key()), null);
});
