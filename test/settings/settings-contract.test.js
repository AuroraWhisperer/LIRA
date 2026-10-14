'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { createSettingsStore, DEFAULT_SETTINGS } = require('../../src/storage/settings-store');
const { routes } = require('../../src/server/routes/settings-routes');
const { createWeSingCapture } = require('../../src/music/wesing-capture');

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
      writeHead(status) {
        this.status = status;
      },
      end(text) {
        this.payload = JSON.parse(text);
      },
    };
    await routes['POST /api/settings'](context, { body: async () => body }, response);
    return response;
  }
  return { db, store, context, dirtyScopes, post };
}

test('new request controls default to no additional restrictions and synchronize optional values', async (t) => {
  const f = fixture(t);
  const { SONG_REQUEST_CONTROL_DEFAULTS, SONG_REQUEST_CONTROL_KEYS } = require('../../src/shared/song-request-settings');
  const { serializeCloudSettings, normalizeCloudSettingsSnapshot } = require('../../src/server/settings-contract');
  for (const [key, value] of Object.entries(SONG_REQUEST_CONTROL_DEFAULTS)) {
    assert.equal(f.store.getSettings()[key], value);
  }
  const patch = {
    userQueueLimit: ' 02 ', userCooldownCaptainSeconds: '', userCooldownAdmiralSeconds: 0,
    userCooldownGovernorSeconds: '0030', songRequestMinMedalLevel: 5, songRequestGuardLevel: 3,
    songRequestGuardMedalBypass: true,
    songRequestUserBlacklist: [{ uid: '123', name: ' 测试用户 ', expiresAt: 0 }],
  };
  assert.equal((await f.post(patch)).status, 200);
  assert.deepEqual(f.dirtyScopes, ['settings']);
  const saved = createSettingsStore(f.db).getSettings();
  const cloud = serializeCloudSettings(saved);
  assert.deepEqual(Object.fromEntries(SONG_REQUEST_CONTROL_KEYS.map((key) => [key, cloud[key]])), {
    ...patch, userQueueLimit: 2, userCooldownGovernorSeconds: 30,
    songRequestUserBlacklist: [{ uid: '123', name: '测试用户', expiresAt: 0 }],
  });
  assert.equal(normalizeCloudSettingsSnapshot(cloud).userCooldownCaptainSeconds, '');
  assert.equal(normalizeCloudSettingsSnapshot(cloud).userCooldownAdmiralSeconds, '0');
  for (const key of SONG_REQUEST_CONTROL_KEYS) delete cloud[key];
  f.store.setSettings(normalizeCloudSettingsSnapshot(cloud));
  for (const key of SONG_REQUEST_CONTROL_KEYS) assert.equal(f.store.getSettings()[key], saved[key]);
  assert.equal((await f.post(SONG_REQUEST_CONTROL_DEFAULTS)).status, 200);
  for (const [key, value] of Object.entries(SONG_REQUEST_CONTROL_DEFAULTS)) assert.equal(f.store.getSettings()[key], value);
});

test('request control limits reject invalid batches without saving or requesting sync', async (t) => {
  const f = fixture(t);
  const cases = {
    userQueueLimit: [-1, 301, '', ' ', true, null, [], {}, 1.5, '1e2'],
    userCooldownCaptainSeconds: [-1, 3601, ' ', null, [], false, 0.5],
    userCooldownAdmiralSeconds: [-1, 'NaN'],
    userCooldownGovernorSeconds: [3601, '1e2'],
    songRequestMinMedalLevel: [-1, 101, '', true],
    songRequestGuardLevel: [-1, 4, 'captain', true],
    songRequestGuardMedalBypass: [null, [], {}, 'TRUE', ' false ', 2],
  };
  for (const [key, values] of Object.entries(cases)) {
    for (const value of values) {
      assert.equal((await f.post({ paused: true, [key]: value })).status, 400, `${key}: ${JSON.stringify(value)}`);
      assert.equal(f.store.getSettings().paused, 'false');
    }
  }
  assert.deepEqual(f.dirtyScopes, []);
});

test('user blacklist validates stable IDs and deadlines', async (t) => {
  const f = fixture(t);
  const valid = [{ uid: '123' }, { uid: '9999999999999999999999999', name: '🎵'.repeat(80), expiresAt: 253402300799999 }];
  assert.equal((await f.post({ songRequestUserBlacklist: JSON.stringify(valid) })).status, 200);
  const saved = f.store.getSettings().songRequestUserBlacklist;
  assert.deepEqual(JSON.parse(saved)[0], { uid: '123', name: '', expiresAt: 0 });
  for (const value of [null, {}, 'bad json', [null], [{ uid: 123 }], [{ uid: '0' }], [{ uid: ' 123' }],
    [{ uid: '123', name: null }], [{ uid: '123', name: '🎵'.repeat(81) }], [{ uid: '123', expiresAt: '0' }],
    [{ uid: '123', expiresAt: -1 }], [{ uid: '123', expiresAt: 1.5 }], [{ uid: '123', expiresAt: 253402300800000 }],
    [{ uid: '123', extra: true }], [{ uid: '123' }, { uid: '123', name: '改名' }],
    Array.from({ length: 201 }, (_, i) => ({ uid: String(i + 1) }))]) {
    assert.equal((await f.post({ paused: true, songRequestUserBlacklist: value })).status, 400);
    assert.equal(f.store.getSettings().paused, 'false');
    assert.equal(f.store.getSettings().songRequestUserBlacklist, saved);
  }
});

test('guard priority is opt-in, validates atomically and preserves its value with old cloud snapshots', async (t) => {
  const f = fixture(t);
  assert.equal(f.store.getSettings().guardPriorityEnabled, 'false');
  for (const value of [null, [], {}, 'yes', 2]) {
    assert.equal((await f.post({ paused: true, guardPriorityEnabled: value })).status, 400);
    assert.equal(f.store.getSettings().paused, 'false');
  }
  assert.equal((await f.post({ guardPriorityEnabled: true })).status, 200);
  assert.deepEqual(f.dirtyScopes, ['settings']);
  const { serializeCloudSettings, normalizeCloudSettingsSnapshot } = require('../../src/server/settings-contract');
  const saved = createSettingsStore(f.db).getSettings();
  const cloud = serializeCloudSettings(saved);
  assert.equal(cloud.guardPriorityEnabled, true);
  assert.equal(normalizeCloudSettingsSnapshot(cloud).guardPriorityEnabled, 'true');
  delete cloud.guardPriorityEnabled;
  f.store.setSettings(normalizeCloudSettingsSnapshot(cloud));
  assert.equal(f.store.getSettings().guardPriorityEnabled, 'true');
});

test('song cooldown settings validate atomically, synchronize and survive reopening', async (t) => {
  const f = fixture(t);
  assert.equal(f.store.getSettings().songCooldownMode, 'off');
  assert.equal(f.store.getSettings().songCooldownValue, '1');
  for (const body of [{ songCooldownMode: 'week' }, ...[0, 1000, 1.5, true, null, [], '', '1e2'].map(
    (value) => ({ songCooldownValue: value }))]) {
    assert.equal((await f.post({ paused: true, ...body })).status, 400);
    assert.equal(f.store.getSettings().paused, 'false');
  }
  assert.deepEqual(f.dirtyScopes, []);
  assert.equal((await f.post({ songCooldownMode: 'days', songCooldownValue: ' 02 ' })).status, 200);
  assert.deepEqual(f.dirtyScopes, ['settings']);
  const reopened = createSettingsStore(f.db).getSettings();
  assert.equal(reopened.songCooldownMode, 'days');
  assert.equal(reopened.songCooldownValue, '2');
  const { serializeCloudSettings, normalizeCloudSettingsSnapshot } = require('../../src/server/settings-contract');
  const cloud = serializeCloudSettings(reopened);
  assert.equal(cloud.songCooldownValue, 2);
  assert.equal(normalizeCloudSettingsSnapshot(cloud).songCooldownMode, 'days');
  delete cloud.songCooldownMode;
  delete cloud.songCooldownValue;
  f.store.setSettings(normalizeCloudSettingsSnapshot(cloud));
  assert.equal(f.store.getSettings().songCooldownValue, '2', 'old servers must not erase locally saved cooldown');
});

test('room revision follows committed changes without persisting or counting unrelated writes', async (t) => {
  const { db, store, post } = fixture(t);
  assert.equal(store.getRoomRevision(), 0);
  store.setSettings({ roomId: '100', paused: 'true' });
  assert.equal(store.getRoomRevision(), 1);
  store.setSetting('roomId', '100');
  store.setSettings({ paused: 'false' });
  await post({ roomId: 'https://live.bilibili.com/100' });
  assert.equal(store.getRoomRevision(), 1);
  store.setSettings({ roomId: '200' }, { syncPending: false });
  store.setSetting('roomId', '100');
  assert.equal(store.getRoomRevision(), 3);

  db.exec("CREATE TEMP TRIGGER reject_room_update BEFORE UPDATE ON settings WHEN NEW.key = 'roomId' BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END");
  assert.throws(() => store.setSettings({ roomId: '200' }), /synthetic write failure/);
  assert.throws(() => store.prepareCloudRoomAccount('first'), /synthetic write failure/);
  assert.equal(store.getSettings().roomId, '100');
  assert.equal(store.getRoomRevision(), 3);
  db.exec('DROP TRIGGER reject_room_update');
  store.prepareCloudRoomAccount('first');
  assert.equal(store.getRoomRevision(), 4);
  store.prepareCloudRoomAccount('second');
  store.prepareCloudRoomAccount('second');
  assert.equal(store.getRoomRevision(), 4, 'ownership changes with an already empty room do not change the room');
  assert.equal(createSettingsStore(db).getRoomRevision(), 0, 'the revision only belongs to this process instance');
  assert.equal(Object.hasOwn(store.getSettings(), 'roomRevision'), false);
});

test('heart box display settings persist optional multiplier, zero remaining and independent visibility', async t => {
  const f = fixture(t);
  assert.equal(f.store.getSettings().blindboxCastleMultiplier, '');
  assert.equal(f.store.getSettings().blindboxShowOpenedSinceCastle, 'false');
  assert.equal(f.store.getSettings().blindboxCompact, 'false');
  assert.equal(f.store.getSettings().blindboxAutoPages, 'true');
  assert.equal((await f.post({ blindboxCastleMultiplier: '1.25', blindboxCastlesRemaining: 0,
    blindboxShowCastlesRemaining: true, blindboxShowOpenedSinceCastle: true,
    blindboxCompact: true, blindboxAutoPages: false })).status, 200);
  const saved = createSettingsStore(f.db).getSettings();
  assert.equal(saved.blindboxCastleMultiplier, '1.25');
  assert.equal(saved.blindboxCastlesRemaining, '0');
  assert.equal(saved.blindboxShowCastlesRemaining, 'true');
  assert.equal(saved.blindboxCompact, 'true');
  assert.equal(saved.blindboxAutoPages, 'false');
  for (const key of ['blindboxCompact', 'blindboxAutoPages']) assert.equal((await f.post({ [key]: 'yes' })).status, 400);
  for (const value of [-1, 0, 1001, 'NaN', true, '0.001']) {
    assert.equal((await f.post({ blindboxCastleMultiplier: value })).status, 400);
  }
  for (const value of [-1, 1.5, 100000, '', false]) {
    assert.equal((await f.post({ blindboxCastlesRemaining: value })).status, 400);
  }
  assert.equal((await f.post({ blindboxCastleMultiplier: '', blindboxShowCastlesRemaining: false })).status, 200);
  assert.equal(f.store.getSettings().blindboxCastleMultiplier, '');
});

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

test('clock moon settings default on old stores and persist atomically across reopening', async (t) => {
  const f = fixture(t);
  const { getClockConfig } = require('../../src/server/clock-contract');
  assert.equal(getClockConfig(f.store.getSettings()).moonMode, 'light');
  assert.equal(getClockConfig(f.store.getSettings()).moonIntervalSeconds, 30);
  assert.equal((await f.post({ clockMoonMode: 'auto', clockMoonIntervalSeconds: 7 })).status, 200);
  const reopened = createSettingsStore(f.db).getSettings();
  assert.equal(reopened.clockMoonMode, 'auto');
  assert.equal(reopened.clockMoonIntervalSeconds, '7');
  for (const value of [0, 1.5, 86401]) {
    assert.equal((await f.post({ clockMoonMode: 'dark', clockMoonIntervalSeconds: value })).status, 400);
    assert.equal(f.store.getSettings().clockMoonMode, 'auto');
    assert.equal(f.store.getSettings().clockMoonIntervalSeconds, '7');
  }
  for (const value of [1, 86400]) assert.equal((await f.post({ clockMoonIntervalSeconds: value })).status, 200);
});

test('clock style profiles migrate desktop values, isolate styles, and validate legacy and profile writes atomically', async t => {
  const f = fixture(t);
  const { getClockConfig } = require('../../src/server/clock-contract');
  f.store.setSettings({ clockLabel: '已有客户端文案', clockShowDate: 'false' });
  const first = getClockConfig(f.store.getSettings());
  assert.equal(first.styleOptions.peach.label, '已有客户端文案');
  assert.equal(first.styleOptions.flip.showDate, false);
  const options = structuredClone(first.styleOptions);
  options.flip.flipTextColor = '#abcdef';
  assert.equal((await f.post({ clockStyleOptions: JSON.stringify(options) })).status, 200);
  assert.equal((await f.post({ clockStyle: 'peach', clockLabel: '旧入口写入' })).status, 200);
  let config = getClockConfig(createSettingsStore(f.db).getSettings());
  assert.equal(config.styleOptions.peach.label, '旧入口写入');
  assert.equal(config.styleOptions.flip.label, '已有客户端文案');
  assert.equal(config.styleOptions.flip.flipTextColor, '#abcdef');
  assert.equal((await f.post({ clockStyle: 'flip' })).status, 200);
  config = getClockConfig(f.store.getSettings());
  assert.equal(config.label, '已有客户端文案');
  assert.equal(config.flipTextColor, '#abcdef');
  for (const invalid of [{ flip: { extra: true } }, { unknown: {} }, { flip: { showDate: 'invalid' } }, null]) {
    assert.equal((await f.post({ clockLabel: '不应写入', clockStyleOptions: JSON.stringify(invalid) })).status, 400);
    assert.equal(f.store.getSettings().clockLabel, '旧入口写入');
  }
});

test('song request blacklist persists normalized lines locally and can be cleared', async (t) => {
  const f = fixture(t);
  assert.equal(f.store.getSettings().songRequestBlacklist, '');
  assert.equal((await f.post({ songRequestBlacklist: ' 78 \r\n\n不要唱\r78\r\n hello   world ' })).status, 200);
  assert.equal(createSettingsStore(f.db).getSettings().songRequestBlacklist, '78\n不要唱\nhello world');
  assert.deepEqual(f.dirtyScopes, []);
  for (const invalid of [78, ['78'], null, { word: '78' }]) {
    assert.equal((await f.post({ paused: true, songRequestBlacklist: invalid })).status, 400);
    assert.equal(f.store.getSettings().paused, 'false');
    assert.equal(f.store.getSettings().songRequestBlacklist, '78\n不要唱\nhello world');
  }
  assert.equal((await f.post({ songRequestBlacklist: ' \r\n ' })).status, 200);
  assert.equal(createSettingsStore(f.db).getSettings().songRequestBlacklist, '');
});

test('interaction appearance persists, preserves saved values on reinitialization and rejects invalid batches atomically', async (t) => {
  const f = fixture(t);
  assert.equal(f.store.getSettings().interactionBackgroundOpacity, '100');
  const result = await f.post({
    interactionOverlayTitle: '  今晚唱什么  ',
    interactionBarColor: '#CDEFEA',
    interactionBackgroundOpacity: 0,
    interactionRatingRules: '弹幕评分\r\n仅发整数\n\n取最后一次',
    interactionOverallOpacity: 65,
    interactionFontSize: 24,
    interactionCornerRadius: 0,
    interactionShowStatus: false,
    interactionShowParticipants: 'false',
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
    { interactionBarColor: 'red' },
    { interactionBackgroundOpacity: 101 },
    { interactionOverlayHint: '长'.repeat(81) },
    { interactionRatingRules: ['非法类型'] },
    { interactionOverallOpacity: -1 },
    { interactionFontSize: 25 },
    { interactionCornerRadius: 33 },
    { interactionShowStatus: 'yes' },
    { interactionShowParticipants: 1 },
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
  assert.equal((await f.post({ queueLimit: '300', userCooldownSeconds: 3600, paused: 1 })).status, 200);
  assert.equal(f.store.getSettings().paused, 'true');
  assert.equal((await f.post({ queueLimit: ' 050 ', userCooldownSeconds: '00' })).status, 200);
});

test('settings store rolls back a failed batch without invalidating the cached state', (t) => {
  const f = fixture(t);
  const before = f.store.getSettings();
  f.db.exec(
    "CREATE TRIGGER fail_theme BEFORE UPDATE ON settings WHEN NEW.key = 'themeOpacity' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
  );
  assert.throws(() => f.store.setSettings({ paused: 'true', themeOpacity: '0.8' }), /fixture failure/);
  assert.deepEqual(f.store.getSettings(), before);
  assert.equal(f.db.prepare("SELECT value FROM settings WHERE key = 'paused'").get().value, 'false');
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
  await assert.rejects(
    f.post({
      weSingCachePath: path.join(root, 'next', 'WeSingCache'),
      weSingLyricOffsetMs: 250,
      paused: true,
    }),
    /fixture setting failure/,
  );
  assert.deepEqual(f.store.getSettings(), before);
  assert.equal(capture.getStatus().cachePath, previousCachePath);
  assert.equal(capture.getStatus().lyricOffsetMs, 0);
  assert.deepEqual(f.dirtyScopes, []);
});
