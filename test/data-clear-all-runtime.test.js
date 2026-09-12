'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-clear-runtime-'));
const originalDataDir = process.env.SONG_PLUGIN_DATA_DIR;
process.env.SONG_PLUGIN_DATA_DIR = root;
test.after(() => {
  if (originalDataDir === undefined) delete process.env.SONG_PLUGIN_DATA_DIR;
  else process.env.SONG_PLUGIN_DATA_DIR = originalDataDir;
  fs.rmSync(root, { recursive: true, force: true });
});

const { createDatabases, closeDatabases } = require('../src/storage/database');
const { createSettingsStore } = require('../src/storage/settings-store');
const { createDomainServices } = require('../src/server/domain-services');
const { createRuntimeApiContextFactory } = require('../src/server/runtime-api-context');
const { routes } = require('../src/server/routes/data-routes');
const clearAll = routes['POST /api/database/clear-all'];

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(root, 'case-'));
  const db = createDatabases({ dataDir });
  const timers = new Set();
  t.mock.method(global, 'setTimeout', (callback) => {
    const timer = { callback, unref() {} };
    timers.add(timer);
    return timer;
  });
  t.mock.method(global, 'clearTimeout', (timer) => timers.delete(timer));
  const settingsStore = createSettingsStore(db.songDb);
  settingsStore.setSetting('enableGiftSprint', 'true');
  const services = createDomainServices({ db, settingsStore });
  services.songs.ensureCategory('保留分类');
  services.overtime.setTime({ remainingSeconds: 120 });
  services.overtime.act('enable');
  services.overtime.act('start');
  const broadcasts = [];
  const syncs = [];
  const noop = () => {};
  const context = createRuntimeApiContextFactory({
    maxBodyBytes: 1024,
    getDomainServices: () => services,
    getSettingsStore: () => settingsStore,
    getSessionToken: () => '',
    broadcastSnapshot: (reason) => broadcasts.push(reason),
    requestCloudSync: (scope) => syncs.push(scope),
    getMusicRuntime: () => ({
      getMusicRegistry: () => ({}), lyricsService: {},
      publishLyricState: noop, publishLyricTimeline: noop,
      weSingCapture: {},
    }),
    getBilibiliRuntime: () => ({ getAuthProvider: () => null }),
    getAiRuntime: () => ({ configStore: {}, service: {} }),
    getLiveStatus: () => ({}),
    getDanmakuSender: () => ({}),
    getGameSessionService: () => undefined,
    getWheelSessionService: () => undefined,
    musicApiCacheDir: path.join(dataDir, 'api-cache'),
    musicLyricCacheDir: path.join(dataDir, 'lyric-cache'),
  })();
  t.after(() => {
    services.gifts.dispose();
    services.overtime.dispose();
    closeDatabases(db);
  });
  return { db, services, context, timers, broadcasts, syncs };
}

function response() {
  return {
    status: 0,
    payload: null,
    writeHead(status) { this.status = status; },
    end(body) { this.payload = JSON.parse(body); },
  };
}

function request() {
  return { body: async () => ({ confirm: true }) };
}

function gift() {
  return {
    platformId: 'clear-all-late-gift', cmd: 'SEND_GIFT', giftId: '1',
    giftName: '测试礼物', num: 1, unitPrice: 1, totalPrice: 1,
    uid: '1', userName: '测试观众',
  };
}

function assertPaused(f) {
  assert.equal(f.timers.size, 0);
  assert.equal(f.services.gifts.add(gift()), null);
  assert.throws(() => f.services.gifts.importProcessedEvent({}, 1), /GIFT_DETECTION_PAUSED/);
  assert.throws(() => f.services.gifts.importProcessedHistoryRecord({}, 1), /GIFT_DETECTION_PAUSED/);
  assert.equal(f.services.gifts.pauseDetection(), false);
  assert.equal(f.services.overtime.pauseRecovery(), false);
  assert.deepEqual(f.broadcasts, []);
  assert.deepEqual(f.syncs, []);
}

test('real runtime context exposes writer controls and resumes after successful clear', async (t) => {
  const f = fixture(t);
  assert.equal(f.context.gifts.pauseDetection, f.services.gifts.pauseDetection);
  assert.equal(typeof f.context.gifts.pauseDetection, 'function');
  assert.equal(f.context.overtime.resumeRecovery, f.services.overtime.resumeRecovery);
  assert.equal(typeof f.context.overtime.resumeRecovery, 'function');
  const res = response();
  await clearAll(f.context, request(), res);
  assert.equal(res.status, 200);
  assert.equal(res.payload.data.cleared, true);
  assert.equal(f.services.overtime.getSnapshot().enabled, false);
  assert.deepEqual(f.services.songs.listCategories().map((row) => row.name), ['默认']);
  assert.ok(f.services.gifts.add(gift()));
  assert.deepEqual(f.broadcasts, ['database:clear-all']);
  assert.deepEqual(f.syncs, ['songs']);
});

test('default insertion failure rolls back and resumes real writers', async (t) => {
  const f = fixture(t);
  f.db.giftDb.exec(`CREATE TEMP TRIGGER fail_defaults BEFORE INSERT ON overtime_machine_state
    BEGIN SELECT RAISE(ABORT, 'default insert failed'); END`);
  await assert.rejects(clearAll(f.context, request(), response()), /pre-commit failed/);
  assert.equal(f.services.overtime.getSnapshot().enabled, true);
  assert.deepEqual(f.services.songs.listCategories().map((row) => row.name), ['保留分类']);
  assert.ok(f.timers.size > 0);
  assert.ok(f.services.gifts.add(gift()));
  assert.deepEqual(f.broadcasts, []);
});

test('partial commit keeps real timers and imports paused, including a failed retry', async (t) => {
  const f = fixture(t);
  const exec = f.db.musicDb.exec;
  t.mock.method(f.db.musicDb, 'exec', function (sql) {
    if (sql === 'COMMIT') throw new Error('music commit failed');
    return exec.call(this, sql);
  });
  const res = response();
  await clearAll(f.context, request(), res);
  assert.equal(res.status, 500);
  assert.equal(res.payload.partial, true);
  assert.deepEqual(res.payload.data.committed, ['songDb', 'superChatDb', 'giftDb']);
  assert.equal(f.db.giftDb.prepare('SELECT enabled FROM overtime_machine_state').get().enabled, 0);
  assertPaused(f);

  f.db.songDb.exec(`CREATE TEMP TRIGGER fail_defaults BEFORE INSERT ON song_categories
    BEGIN SELECT RAISE(ABORT, 'retry default failed'); END`);
  await assert.rejects(clearAll(f.context, request(), response()), /pre-commit failed/);
  assertPaused(f);

  f.db.songDb.exec('DROP TRIGGER fail_defaults');
  f.db.musicDb.exec = exec;
  const retried = response();
  await clearAll(f.context, request(), retried);
  assert.equal(retried.status, 200);
  assert.ok(f.services.gifts.add(gift()));
});

test('post-commit runtime reload failure returns partial and keeps writers paused', async (t) => {
  const f = fixture(t);
  t.mock.method(f.services.overtime, 'reloadState', () => { throw new Error('reload failed'); });
  const res = response();
  await clearAll(f.context, request(), res);
  assert.equal(res.status, 500);
  assert.equal(res.payload.partial, true);
  assert.equal(res.payload.data.cleared, false);
  assert.equal(res.payload.data.phase, 'runtime-reset');
  assertPaused(f);
});

test('writer resume failure returns partial and pauses both writers again', async (t) => {
  const f = fixture(t);
  t.mock.method(f.context.gifts, 'resumeDetection', () => { throw new Error('resume failed'); });
  const res = response();
  await clearAll(f.context, request(), res);
  assert.equal(res.status, 500);
  assert.equal(res.payload.partial, true);
  assert.equal(res.payload.data.cleared, false);
  assert.equal(res.payload.data.phase, 'resume');
  assertPaused(f);
});

test('failed rollback is partial and never resumes real writers', async (t) => {
  const f = fixture(t);
  f.db.giftDb.exec(`CREATE TEMP TRIGGER fail_defaults BEFORE INSERT ON overtime_machine_state
    BEGIN SELECT RAISE(ABORT, 'default insert failed'); END`);
  const exec = f.db.songDb.exec;
  t.mock.method(f.db.songDb, 'exec', function (sql) {
    if (sql === 'ROLLBACK') throw new Error('rollback failed');
    return exec.call(this, sql);
  });
  const res = response();
  await clearAll(f.context, request(), res);
  assert.equal(res.status, 500);
  assert.equal(res.payload.partial, true);
  assert.deepEqual(res.payload.data.committed, []);
  assert.deepEqual(res.payload.data.rollbackFailed, ['songDb']);
  assertPaused(f);
});
