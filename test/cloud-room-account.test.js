'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createSettingsStore } = require('../src/storage/settings-store');
const { createCloudSyncController } = require('../src/electron/cloud-sync-controller');

test('room ownership survives closing and reopening the settings database', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-room-store-'));
  const filename = path.join(directory, 'settings.db');
  let db = new DatabaseSync(filename);
  try {
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
    const original = createSettingsStore(db);
    original.prepareCloudRoomAccount('first');
    original.setSetting('roomId', '111');
    db.close();
    db = new DatabaseSync(filename);
    const restored = createSettingsStore(db);
    assert.equal(restored.prepareCloudRoomAccount('first'), false);
    assert.equal(restored.getSettings().roomId, '111');
    assert.equal(restored.prepareCloudRoomAccount('second'), true);
    assert.equal(restored.getSettings().roomId, '');
    assert.equal(restored.getDefaultSettings().cloudRoomAccountKey, undefined);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createFixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  const store = createSettingsStore(db);
  store.setSetting('roomId', '1716079620');
  let identity = { accountName: 'first', streamerId: 1 };
  let origin = 'https://api.example.test';
  let state = 'authorized';
  let listener;
  let controller;
  let failUpload = false;
  const cloud = new Map();
  const uploads = [];
  const key = () => JSON.stringify([origin, identity?.accountName, identity?.streamerId]);
  const values = () => ({
    roomId: store.getSettings().roomId,
    enableBilibili: false,
    paused: false,
    queueLimit: 50,
    userCooldownSeconds: 0,
    onlyFromLibrary: false,
    allowDuplicate: true,
    giftBlindBoxConfig: [],
  });
  const licenseManager = {
    LicenseState: { AUTHORIZED: 'authorized' },
    getState: () => state,
    getSnapshot: () => ({ streamer: identity }),
    getCloudSyncIdentity: () => identity,
    getRemoteBaseUrl: () => origin,
    onStateChanged(callback) {
      listener = callback;
      return () => {
        listener = null;
      };
    },
    async getCloudState() {
      return {
        settings: cloud.get(key()) || {
          initialized: false,
          revision: 0,
          values: {},
        },
        songs: { initialized: true, revision: 1 },
        bilibili: { initialized: false, revision: 0 },
      };
    },
    async updateCloudSettings(input) {
      uploads.push({ account: key(), roomId: input.roomId });
      if (failUpload) throw new Error('NETWORK_UNAVAILABLE');
      const result = {
        initialized: true,
        revision: (cloud.get(key())?.revision || 0) + 1,
        values: input,
      };
      cloud.set(key(), result);
      return result;
    },
    getCloudSongs: async () => ({ revision: 1, songs: [] }),
  };
  const runtime = {
    prepareCloudRoomAccount: (accountKey) => store.prepareCloudRoomAccount(accountKey),
    getCloudSettingsSnapshot: values,
    applyCloudSettingsSnapshot: (input) => store.setSetting('roomId', input.roomId || ''),
    replaceCloudSongsSnapshot() {},
  };
  function restart() {
    controller?.dispose();
    controller = createCloudSyncController({
      licenseManager,
      runtime,
      bilibiliAuth: { async logout() {} },
      timers: { setTimeout: () => ({ unref() {} }), clearTimeout() {} },
    });
    return controller;
  }
  restart();
  t.after(() => {
    controller.dispose();
    db.close();
  });
  return {
    db,
    store,
    cloud,
    uploads,
    key,
    restart,
    get controller() {
      return controller;
    },
    setIdentity(value) {
      identity = value;
    },
    setOrigin(value) {
      origin = value;
    },
    setState(value) {
      state = value;
      listener?.({ state });
    },
    setFailUpload(value) {
      failUpload = value;
    },
    editRoom(value) {
      store.setSetting('roomId', value);
      controller.markDirty('settings');
    },
  };
}

test('a newly authorized account seeds an empty room instead of unowned local data', async (t) => {
  const fixture = createFixture(t);
  await fixture.controller.start();
  assert.deepEqual(fixture.uploads, [{ account: fixture.key(), roomId: '' }]);
  assert.equal(fixture.store.getSettings().roomId, '');
  assert.equal(fixture.store.getSettings().cloudRoomAccountKey, undefined);
});

test('an account switch clears an old dirty room before another setting can upload it', async (t) => {
  const fixture = createFixture(t);
  await fixture.controller.start();
  fixture.setFailUpload(true);
  fixture.editRoom('111');
  await fixture.controller.whenIdle();
  fixture.setFailUpload(false);
  fixture.setIdentity({ accountName: 'second', streamerId: 2 });
  fixture.controller.markDirty('settings');
  await fixture.controller.whenIdle();
  assert.equal(fixture.cloud.get(fixture.key()).values.roomId, '');
  assert.equal(fixture.uploads.at(-1).roomId, '');
});

for (const change of ['account', 'origin', 'recreated account']) {
  test(`restart with a different ${change} cannot inherit the saved room`, async (t) => {
    const fixture = createFixture(t);
    await fixture.controller.start();
    fixture.editRoom('111');
    await fixture.controller.whenIdle();
    if (change === 'account') fixture.setIdentity({ accountName: 'second', streamerId: 2 });
    if (change === 'origin') fixture.setOrigin('https://other.example.test');
    if (change === 'recreated account') fixture.setIdentity({ accountName: 'first', streamerId: 3 });
    await fixture.restart().start();
    assert.equal(fixture.store.getSettings().roomId, '');
    assert.equal(fixture.uploads.at(-1).roomId, '');
  });
}

test('the same owner retains its room across restart and temporary authorization loss', async (t) => {
  const fixture = createFixture(t);
  await fixture.controller.start();
  fixture.editRoom('111');
  await fixture.controller.whenIdle();
  const ownerUpdatedAt = fixture.db
    .prepare('SELECT updated_at FROM settings WHERE key=?')
    .get('cloudRoomAccountKey').updated_at;
  await fixture.restart().start();
  assert.equal(fixture.store.getSettings().roomId, '111');
  assert.equal(
    fixture.db.prepare('SELECT updated_at FROM settings WHERE key=?').get('cloudRoomAccountKey').updated_at,
    ownerUpdatedAt,
  );
  fixture.setFailUpload(true);
  fixture.editRoom('222');
  await fixture.controller.whenIdle();
  fixture.setState('blocked');
  fixture.setFailUpload(false);
  fixture.setState('authorized');
  await fixture.controller.whenIdle();
  assert.equal(fixture.cloud.get(fixture.key()).values.roomId, '222');
});

test('an existing cloud room restores after an unowned local room is detached', async (t) => {
  const fixture = createFixture(t);
  fixture.cloud.set(fixture.key(), {
    initialized: true,
    revision: 3,
    values: { roomId: '333', giftBlindBoxConfig: [] },
  });
  await fixture.controller.start();
  assert.equal(fixture.store.getSettings().roomId, '333');
  assert.deepEqual(fixture.uploads, []);
});

test('failed first sync and restart never resurrect the detached room', async (t) => {
  const fixture = createFixture(t);
  fixture.setFailUpload(true);
  await fixture.controller.start();
  fixture.setFailUpload(false);
  await fixture.restart().start();
  assert.equal(fixture.cloud.get(fixture.key()).values.roomId, '');
  assert.equal(
    fixture.uploads.every(({ roomId }) => roomId === ''),
    true,
  );
});

test('missing stable tenant identity and unauthorized edits cannot claim or upload a room', async (t) => {
  const fixture = createFixture(t);
  fixture.setState('needs_activation');
  fixture.editRoom('444');
  fixture.setIdentity({ accountName: 'first' });
  fixture.setState('authorized');
  await fixture.controller.whenIdle();
  assert.deepEqual(fixture.uploads, []);
  assert.equal(fixture.store.getSettings().roomId, '444');
  fixture.setIdentity({ accountName: 'first', streamerId: 1 });
  await fixture.controller.start();
  assert.equal(fixture.uploads.at(-1).roomId, '');
});

test('room and owner reset roll back together and storage failure prevents cloud writes', async (t) => {
  const fixture = createFixture(t);
  await fixture.controller.start();
  fixture.editRoom('111');
  await fixture.controller.whenIdle();
  const oldKey = fixture.key();
  fixture.db.exec(
    "CREATE TRIGGER reject_owner BEFORE UPDATE ON settings WHEN NEW.key='cloudRoomAccountKey' BEGIN SELECT RAISE(ABORT, 'OWNER_WRITE_FAILED'); END",
  );
  fixture.setIdentity({ accountName: 'second', streamerId: 2 });
  const count = fixture.uploads.length;
  await assert.rejects(async () => fixture.controller.start(), /OWNER_WRITE_FAILED/);
  assert.equal(fixture.store.getSettings().roomId, '111');
  assert.equal(fixture.db.prepare('SELECT value FROM settings WHERE key=?').get('cloudRoomAccountKey').value, oldKey);
  assert.equal(fixture.uploads.length, count);
});
