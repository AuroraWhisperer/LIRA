'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { createSceneRuntime } = require('../../src/server/scene-runtime');
const { createBilibiliRuntime } = require('../../src/server/bilibili-runtime');
const { BilibiliApiClient } = require('../../src/bilibili/danmaku/api-client');
const { migrateScenes, migrateComponentOutputSizes, migrateCanvasPresets, migrateSceneDeletion } = require('../../src/storage/scene-migration');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-store');
const { migrateDanmakuAppearance } = require('../../src/storage/danmaku-appearance-store');
const { createSceneExtraDefaults } = require('../../public/js/shared/scene-extra-components.js');
const { createGiftService } = require('../../src/bilibili/gift');
const { createFixture: createGiftFixture } = require('../helpers/gift-query-fixture');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');

function fixture(t, ports = {}, getState = () => ({ settings: DEFAULT_SETTINGS })) {
  const db = new DatabaseSync(':memory:');
  migrateScenes(db);
  migrateComponentOutputSizes(db); migrateCanvasPresets(db); migrateSceneDeletion(db);
  migrateDanmakuAppearance(db);
  const state = { owner: { scope: 'synthetic-owner', epoch: 1 } };
  const runtime = createSceneRuntime({ songDb: db, displayPorts: { settings: { get: () => DEFAULT_SETTINGS }, system: { getState }, ...ports },
    runtimeOptions: { getSceneOwner: () => state.owner,
      sceneSecretCodec: { isAvailable: () => true,
        encrypt: value => Buffer.from(value).toString('base64'),
        decrypt: value => Buffer.from(value, 'base64').toString() } } });
  t.after(() => { runtime.dispose(); db.close(); });
  return { runtime, state };
}

function publish(runtime, types) {
  const { service } = runtime;
  const created = service.create({ title: '场景通知', canvas: { width: 1920, height: 1080 } });
  const items = [].concat(types).map(type => ({ id: randomUUID(), type, name: type, x: 0, y: 0, width: 320, height: 180, visible: true, locked: false,
    appearance: ['clock', 'overtime'].includes(type) ? { mode: 'shared' }
      : { mode: 'independent', config: type === 'danmaku'
        ? { style: 'twitter', fullscreenDurationSeconds: 6, styleOptions: {}, layout: null }
        : createSceneExtraDefaults(type) } }));
  const saved = service.save({ id: created.document.id, expectedRevision: created.revision,
    document: { ...created.document, items } });
  const published = service.publish({ id: saved.document.id, expectedRevision: saved.revision });
  return { ...service.getSource(created.document.id), version: published.publishedVersion };
}

function response() {
  const res = new EventEmitter();
  res.writes = [];
  res.destroyed = false;
  res.writableEnded = false;
  res.writeHead = status => { res.status = status; };
  res.write = chunk => { res.writes.push(chunk); return true; };
  res.end = () => { res.writableEnded = true; res.emit('close'); };
  res.destroy = () => { res.destroyed = true; res.emit('close'); };
  return res;
}

test('standalone and scene danmaku map accepted gift images without starting downloads', t => {
  const mapped = [];
  const { runtime, state } = fixture(t, { giftImages: {
    resolveSource(source) { mapped.push(source); return '/overtime-gift-images/settled.png'; },
    ensureImage() { assert.fail('event delivery must not start an image download'); },
  } });
  const update = { ownerScope: state.owner.scope, authorizationEpoch: 1, connectionEpoch: 'gift-source', status: 'connecting' };
  runtime.receiveCloud(update);
  runtime.receiveCloud({ ...update, status: 'connected', event: { type: 'overlay-state', state: 'running', liveStatus: 1,
    liveSessionId: 'live', confirmationMessage: '开播' } });
  const initial = runtime.readDanmakuDisplay({}).data;
  const cursor = { epoch: initial.epoch, cursor: initial.nextCursor };
  const created = runtime.service.create({ title: '图片缓存', canvas: { width: 1920, height: 1080 } });
  const saved = runtime.service.save({ id: created.document.id, expectedRevision: created.revision,
    document: { ...created.document, items: [{ id: randomUUID(), type: 'danmaku', name: '弹幕', x: 0, y: 0,
      width: 600, height: 800, visible: true, locked: false, appearance: { mode: 'independent',
        config: { style: 'glass', fullscreenDurationSeconds: 6, styleOptions: {}, layout: null } } }] } });
  runtime.service.publish({ id: saved.document.id, expectedRevision: saved.revision });
  const source = runtime.service.getSource(saved.document.id);
  const gift = { type: 'gift', liveSessionId: 'live', giftName: '礼物', giftCount: 3,
    giftImageUrl: 'https://i0.hdslb.com/bfs/live/settled.png' };
  runtime.receiveCloud({ ...update, status: 'connected', event: gift });
  runtime.receiveCloud({ ...update, status: 'connected', event: { ...gift, giftGuardLevel: 2 } });
  runtime.receiveCloud({ ...update, authorizationEpoch: 0, status: 'connected', event: { ...gift, giftImageUrl: 'rejected' } });
  for (const display of [runtime.readDanmakuDisplay(cursor).data, runtime.service.getOutput({ ...source, ...cursor }).data.danmaku]) {
    assert.equal(display.events[0].giftImageUrl, '/overtime-gift-images/settled.png');
    assert.equal(display.events[0].giftCount, 3);
    assert.equal(display.events[1].giftImageUrl, '');
    assert.equal(display.events[1].giftGuardLevel, 2);
  }
  assert.deepEqual(mapped, [gift.giftImageUrl, gift.giftImageUrl], 'only accepted ordinary gifts are mapped');
});

test('scene danmaku resolves configured and cloud room aliases through the Bilibili runtime', async t => {
  let roomId = '123', roomRevision = 0;
  const settingsStore = { getSettings: () => ({ ...DEFAULT_SETTINGS, roomId, enableBilibili: 'false', danmakuMonitoringEnabled: 'false' }),
    getRoomRevision: () => roomRevision };
  const bilibili = createBilibiliRuntime({ settingsStore,
    domainServices: { requesterTargets: { getLatestRandomRequester: () => null } },
    broadcastSnapshot() {}, readRoomGuardCount: async () => 0,
    buildClient() { assert.fail('Room profiles must not start a listener'); } });
  t.after(() => bilibili.stop());
  const resolveRoom = t.mock.method(BilibiliApiClient.prototype, 'resolveRoomInfo', async function () {
    assert.equal(this.roomId, roomId);
    return { roomId: 123000, shortId: 123, uid: 456, ownerName: '房主' };
  });
  t.mock.method(BilibiliApiClient.prototype, 'fetchUserProfile', async () => ({ name: '房主', avatarUrl: '' }));
  const { runtime, state } = fixture(t, {
    settings: { get: settingsStore.getSettings, getRoomRevision: settingsStore.getRoomRevision },
    bilibili: { getRoomProfile: options => bilibili.getRoomProfile(options) },
  }, () => ({ liveStatus: bilibili.getLiveStatus() }));
  const update = { ownerScope: state.owner.scope, authorizationEpoch: 1, connectionEpoch: 'profile-alias', status: 'connecting' };
  runtime.receiveCloud(update);
  runtime.receiveCloud({ ...update, status: 'connected', event: { type: 'overlay-state', state: 'running', liveStatus: 1,
    liveSessionId: 'live', confirmationMessage: '开播' } });
  const source = publish(runtime, 'danmaku');
  for (const [configuredRoom, cloudRoom] of [['123', '123'], ['123', '123000'], ['123000', '123'], ['123000', '999']]) {
    if (roomId !== configuredRoom) { roomId = configuredRoom; roomRevision++; }
    bilibili.configure();
    runtime.receiveCloud({ ...update, status: 'connected', event: { type: 'room-guard', roomId: cloudRoom, count: 0 } });
    assert.equal(runtime.service.getOutput(source).data.danmaku.roomProfile, null);
    await new Promise(setImmediate);
    const profile = runtime.service.getOutput(source).data.danmaku.roomProfile;
    if (cloudRoom === '999') assert.equal(profile, null);
    else {
      assert.equal(profile.roomId, '123000');
      assert.equal(profile.uid, '456');
    }
  }
  assert.equal(resolveRoom.mock.callCount(), 4, 'repeated scene reads share each room lookup and cached result');
});

test('scene danmaku projects room profiles only within their owner and room generation', async t => {
  let roomId = '1234', roomRevision = 0, calls = 0, release;
  const getState = () => ({ liveStatus: { roomId } });
  const { runtime, state } = fixture(t, {
    settings: { get: () => ({ ...DEFAULT_SETTINGS, roomId }), getRoomRevision: () => roomRevision },
    bilibili: { getRoomProfile({ expectedRoomId }) {
      assert.equal(expectedRoomId, '1234');
      calls++;
      return new Promise(resolve => { release = resolve; });
    } },
  }, getState);
  const update = { ownerScope: state.owner.scope, authorizationEpoch: 1, connectionEpoch: 'profile-connection', status: 'connecting' };
  runtime.receiveCloud(update);
  runtime.receiveCloud({ ...update, status: 'connected', event: { type: 'overlay-state', state: 'running', liveStatus: 1,
    liveSessionId: 'live', confirmationMessage: '开播', roomGuard: { roomId } } });
  const source = publish(runtime, 'danmaku');
  const first = runtime.service.getOutput(source);
  const second = runtime.service.getOutput(source);
  assert.equal(first.data.danmaku.roomProfile, null, 'Profile loading never delays event delivery');
  assert.equal(second.data.danmaku.roomProfile, null);
  await Promise.resolve();
  assert.equal(calls, 1);
  release({ roomId, uid: 'owner', name: '当前房主', avatarUrl: '', cookie: 'PRIVATE' });
  await new Promise(setImmediate);
  for (const output of [runtime.service.getOutput(source), runtime.service.getOutput(source)]) {
    assert.deepEqual(output.data.danmaku.roomProfile, { roomId, uid: 'owner', name: '当前房主', avatarUrl: '' });
    assert.doesNotMatch(JSON.stringify(output.data), /PRIVATE|cookie/);
  }
  roomId = '5678'; roomRevision++;
  assert.equal(runtime.service.getOutput(source).data.danmaku.roomProfile, null);
  roomId = '1234'; roomRevision++;
  assert.equal(runtime.service.getOutput(source).data.danmaku.roomProfile, null, 'a room round trip cannot reuse cached data');
  await Promise.resolve();
  assert.equal(calls, 2, 'the superseded queued read must not start');
  const notify = t.mock.method(runtime.events, 'notify', () => {});
  state.owner = { ...state.owner, epoch: 2 };
  release({ roomId, uid: 'late-owner', name: '旧账号房主' });
  await new Promise(setImmediate);
  assert.equal(notify.mock.callCount(), 0);
  runtime.receiveCloud({ ...update, authorizationEpoch: 2, connectionEpoch: 'profile-next', status: 'connecting' });
  runtime.receiveCloud({ ...update, authorizationEpoch: 2, connectionEpoch: 'profile-next', status: 'connected',
    event: { type: 'overlay-state', state: 'running', liveStatus: 1, liveSessionId: 'next', confirmationMessage: '开播', roomGuard: { roomId } } });
  runtime.service.getOutput(source);
  await Promise.resolve();
  roomId = '5678'; roomRevision++;
  roomId = '1234'; roomRevision++;
  const notifications = notify.mock.callCount();
  release({ roomId: '1234', uid: 'late', name: '迟到房主' });
  await new Promise(setImmediate);
  assert.equal(notify.mock.callCount(), notifications, 'a completed read cannot survive a room configuration round trip');
  assert.equal(runtime.service.getOutput(source).data.danmaku.roomProfile, null);
});

test('scene disposal cancels queued room profile reads and ignores in-flight completion', async t => {
  for (const started of [false, true]) {
    await t.test(started ? 'in-flight read' : 'queued read', async t => {
      const roomId = '1234';
      let calls = 0, release;
      const { runtime, state } = fixture(t, { settings: { get: () => ({ ...DEFAULT_SETTINGS, roomId }) }, bilibili: { getRoomProfile() {
        calls++;
        return new Promise(resolve => { release = resolve; });
      } } }, () => ({ liveStatus: { roomId } }));
      const update = { ownerScope: state.owner.scope, authorizationEpoch: 1,
        connectionEpoch: 'profile-dispose', status: 'connecting' };
      runtime.receiveCloud(update);
      runtime.receiveCloud({ ...update, status: 'connected', event: { type: 'overlay-state', state: 'running',
        liveStatus: 1, liveSessionId: 'live', confirmationMessage: '开播', roomGuard: { roomId } } });
      const source = publish(runtime, 'danmaku');
      const notify = t.mock.method(runtime.events, 'notify', () => {});
      runtime.service.getOutput(source);
      if (started) await Promise.resolve();
      runtime.dispose();
      await Promise.resolve();
      release?.({ roomId, uid: 'late', name: '迟到房主' });
      await new Promise(setImmediate);
      assert.equal(calls, started ? 1 : 0, 'disposing must prevent a queued upstream read from starting');
      assert.equal(notify.mock.callCount(), 0, 'completed reads must not notify disposed scene resources');
    });
  }
});

test('scene output uses explicit read ports and shares a fresh local snapshot only where needed', async t => {
  let reads = 0;
  let lineText = '当前歌词';
  let nowMs = 10000;
  const getState = () => {
    reads++;
    return { settings: DEFAULT_SETTINGS, lyricState: { lineText, private: 'secret' }, lyricTimeline: { lines: [] },
      overtime: { revision: 1, status: 'running', serverNowMs: nowMs, effectiveRemainingMs: 60000 - nowMs,
        background: { path: '', fit: 'cover' }, rules: [], private: 'secret' },
      nowPlaying: { trackTitle: '当前歌曲', artists: ['歌手'], playing: true, private: 'secret' },
      giftSprint: { targetRmb: 1000, remainingCrystalBalls: 7, private: 'secret' } };
  };
  const { runtime } = fixture(t, { settings: { get: () => DEFAULT_SETTINGS }, system: { getState },
    songs: { list: () => [{ id: 1, name: '公开歌曲', private: 'secret' }], getChangeToken: () => 1 } }, getState);
  for (const types of [['lyrics'], ['now-playing'], ['lyrics', 'now-playing'], ['songlist'], ['lyrics', 'songlist'], ['gift-sprint'], ['lyrics', 'gift-sprint', 'gift-frame'], ['gift-frame'], ['overtime'], ['lyrics', 'overtime']]) {
    const source = publish(runtime, types);
    reads = 0;
    const output = await runtime.service.getOutput(source);
    assert.equal(reads, types.some(type => ['lyrics', 'now-playing', 'gift-sprint', 'overtime'].includes(type)) ? 1 : 0);
    assert.doesNotMatch(JSON.stringify(output), /secret|private/);
    if (types.includes('songlist')) assert.equal(output.data.songlist.songs[0].name, '公开歌曲');
    if (types.includes('gift-sprint')) assert.deepEqual(output.data['gift-sprint'], { targetRmb: 1000, remainingCrystalBalls: 7 });
    if (types.includes('now-playing')) {
      assert.equal(output.data['now-playing'].nowPlaying.trackTitle, '当前歌曲');
      assert.equal(output.data['now-playing'].nowPlaying.playing, true);
    }
    if (types.includes('overtime')) {
      const item = runtime.service.get(source.id).document.items.find(item => item.type === 'overtime');
      assert.equal(output.appearances[item.id].fit, 'cover');
      assert.equal(output.data.overtime.serverNowMs, nowMs);
    }
    if (types.includes('lyrics')) assert.equal(output.data.lyrics.lyricState.lineText, lineText);
    if (types.includes('lyrics') || types.includes('overtime')) {
      lineText += '更新';
      nowMs += 250;
      const next = await runtime.service.getOutput(source);
      assert.equal(reads, 2, 'A later output must read the latest state, not a persistent cache.');
      if (types.includes('lyrics')) assert.equal(next.data.lyrics.lyricState.lineText, lineText);
      if (types.includes('overtime')) assert.equal(next.data.overtime.effectiveRemainingMs, 60000 - nowMs);
    }
  }
});

test('scene blind-box confirmations skip unchanged projections and renew after owner or source transitions', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 8, 18, 12).getTime() });
  const scratchDir = createScratchDirectory('scene-blindbox-');
  const ledger = createGiftFixture({ scratchDir });
  const gifts = createGiftService(ledger.context);
  t.after(() => { gifts.dispose(); ledger.close(); removeScratchDirectory(scratchDir); });
  for (let index = 0; index < 10; index++) {
    ledger.insertGift(null, `local-${index}`, { cmd: 'SEND_GIFT', userName: `Viewer ${index}`,
      isBlindBox: true, blindBoxPrice: 1, totalPrice: 2, createdAt: new Date().toISOString() });
  }
  const stats = t.mock.method(gifts, 'getBlindBoxStats');
  const { runtime, state } = fixture(t, { gifts });
  const source = publish(runtime, ['blindbox', 'lyrics']);
  let known = {};
  function read() {
    const output = runtime.service.getOutput({ ...source, dataVersions: known });
    known = output.dataVersions;
    return output.data.blindbox;
  }
  const first = read();
  assert.equal(first.perUser.length, 10, 'scene instances retain the full leaderboard for their own filters');
  const firstUser = first.perUser[0].userName;
  first.perUser[0].userName = 'consumer mutation';
  assert.equal(runtime.service.getOutput(source).data.blindbox.perUser[0].userName, firstUser);
  for (let index = 0; index < 20; index++) assert.equal(read(), undefined);
  t.mock.timers.tick(6000);
  assert.equal(read(), undefined, 'reconciliation checks the ledger token without reprojecting unchanged rows');
  assert.equal(stats.mock.callCount(), 1);
  runtime.notify({ types: ['blindbox'], invalidateTypes: ['blindbox'] });
  assert.equal(read().summary.boxCount, 10);
  state.owner = { ...state.owner, epoch: 2 };
  assert.equal(read().summary.boxCount, 10, 'an old owner confirmation cannot suppress the baseline');
  const remote = ledger.resolveSource('a'.repeat(64));
  ledger.insertGift(remote.id, 'remote', { isBlindBox: true, blindBoxPrice: 1, totalPrice: 2,
    createdAt: new Date().toISOString() });
  gifts.setActiveSource({ sourceId: remote.id, syncState: 'READY' });
  assert.equal(read().summary.boxCount, 1);
  gifts.setActiveSource({ sourceId: remote.id, syncState: 'SOURCE_SWITCHING' });
  gifts.setActiveSource({ sourceId: remote.id, syncState: 'READY' });
  assert.equal(read().summary.boxCount, 1, 'a source transition renews the baseline even if it returns before the next read');
  ledger.giftDb.exec('BEGIN');
  try {
    ledger.insertGift(remote.id, 'uncommitted', { isBlindBox: true, blindBoxPrice: 1, totalPrice: 2,
      createdAt: new Date().toISOString() });
    assert.equal(read().summary.boxCount, 2, 'a missing committed token cannot reuse the cached projection');
  } finally { ledger.giftDb.exec('ROLLBACK'); }
  assert.equal(read().summary.boxCount, 1);
});

test('scene notifications invalidate only the changed conditional display type', t => {
  let reads = 0;
  const { runtime } = fixture(t, { wheel: { getState() { reads++; return { entries: [] }; } } });
  const source = publish(runtime, 'wheel');
  const initial = runtime.service.getOutput({ ...source, dataVersions: {} });
  const repeat = () => runtime.service.getOutput({ ...source, dataVersions: initial.dataVersions });
  runtime.notify({ types: ['lyrics'] });
  assert.equal(Object.hasOwn(repeat().data, 'wheel'), false);
  assert.equal(reads, 1);
  runtime.notify({ types: ['wheel'] });
  assert.ok(repeat().data.wheel);
  assert.equal(reads, 2);
});

test('live ranking sources accept their data acknowledgement and retain the board until it changes', t => {
  const { runtime } = fixture(t);
  let snapshot = { version: 'ranking-1', room: { roomId: '88' }, boards: [{ id: 'hot', rows: [{ rank: 6, score: 100 }] }] };
  t.mock.method(runtime.liveRankings, 'getSnapshot', () => snapshot);
  const source = publish(runtime, 'live-rankings');
  const first = runtime.service.getOutput({ ...source, dataVersions: {} });
  assert.equal(first.data['live-rankings'].boards[0].rows[0].score, 100);
  const repeated = runtime.service.getOutput({ ...source, dataVersions: first.dataVersions });
  assert.equal(Object.hasOwn(repeated.data, 'live-rankings'), false);
  snapshot = { ...snapshot, version: 'ranking-2', boards: [{ id: 'hot', rows: [{ rank: 5, score: 120 }] }] };
  const changed = runtime.service.getOutput({ ...source, dataVersions: repeated.dataVersions });
  assert.equal(changed.data['live-rankings'].boards[0].rows[0].rank, 5);
});

test('cloud demand follows display reads, leaves other scenes idle and expires after the last read', t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const { runtime } = fixture(t);
  const changes = [];
  runtime.subscribeCloudDemand(active => changes.push(active));
  const clock = publish(runtime, 'clock');
  runtime.service.getOutput(clock);
  runtime.events.open(response(), clock, () => 200);
  assert.deepEqual(changes, [false]);
  runtime.readDanmakuDisplay({});
  runtime.readDanmakuDisplay({});
  t.mock.timers.tick(10000);
  runtime.readDanmakuDisplay({});
  t.mock.timers.tick(14999);
  assert.deepEqual(changes, [false, true]);
  t.mock.timers.tick(1);
  assert.deepEqual(changes, [false, true, false]);
  runtime.readDanmakuDisplay({});
  runtime.dispose();
  assert.deepEqual(changes, [false, true, false, true, false]);
});

for (const mode of ['standalone', 'scene']) {
  test(`${mode} notification heartbeats retain cloud demand when page reads pause`, t => {
    t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
    const { runtime } = fixture(t);
    const changes = [];
    runtime.subscribeCloudDemand(active => changes.push(active));
    const res = response();
    if (mode === 'standalone') runtime.danmakuEvents.open(res, { id: 'danmaku' }, () => 200);
    else {
      const created = runtime.service.create({ title: '仍在使用的弹幕', canvas: { width: 1280, height: 720 } });
      const saved = runtime.service.save({ id: created.document.id, expectedRevision: created.revision,
        document: { ...created.document, items: [{ id: randomUUID(), type: 'danmaku', name: '弹幕',
          x: 0, y: 0, width: 640, height: 400, visible: true, locked: false,
          appearance: { mode: 'independent', config: { style: 'signal', fullscreenDurationSeconds: 6, styleOptions: {}, layout: null } } }] } });
      runtime.service.publish({ id: saved.document.id, expectedRevision: saved.revision });
      runtime.events.open(res, runtime.service.getSource(created.document.id), () => 200);
    }
    runtime.readDanmakuDisplay({});
    for (let seconds = 0; seconds < 60; seconds++) t.mock.timers.tick(1000);
    assert.equal(res.writableEnded, false);
    assert.equal(res.writes.at(-1), ': heartbeat\n\n');
    assert.deepEqual(changes, [false, true]);
    res.end();
    t.mock.timers.tick(14999);
    assert.deepEqual(changes, [false, true]);
    t.mock.timers.tick(1);
    assert.deepEqual(changes, [false, true, false]);
  });
}

test('saved overlay settings remain available without a live connection and reject old owners', t => {
  const { runtime, state } = fixture(t);
  const changes = [];
  runtime.subscribeCloudDemand(active => changes.push(active));
  const update = { ownerScope: state.owner.scope, authorizationEpoch: state.owner.epoch,
    settings: { style: 'bubble', fullscreenDurationSeconds: 8, token: 'not-a-display-field' } };
  assert.equal(runtime.receiveCloudSettings(update), true);
  assert.deepEqual(changes, [false], 'A settings read or save does not itself open a live stream.');
  const display = runtime.readDanmakuDisplay({});
  assert.equal(display.config.style, 'bubble');
  assert.equal(display.data.status, 'offline');
  assert.equal(JSON.stringify(display).includes('not-a-display-field'), false);
  const created = runtime.service.create({ title: '无直播来源时保存', canvas: { width: 1920, height: 1080 } });
  const saved = runtime.service.save({ id: created.document.id, expectedRevision: created.revision,
    document: { ...created.document, items: [{ id: randomUUID(), type: 'danmaku', name: '弹幕',
      x: 0, y: 0, width: 320, height: 180, visible: true, locked: false, appearance: { mode: 'shared' } }] } });
  assert.equal(runtime.service.publish({ id: saved.document.id, expectedRevision: saved.revision }).publishedVersion, 1);
  assert.equal(runtime.receiveCloudSettings({ ...update, settings: { style: 'invalid' } }), false);
  state.owner = { scope: 'other-owner', epoch: 2 };
  assert.equal(runtime.receiveCloudSettings(update), false);
  assert.equal(runtime.readDanmakuDisplay({}).config, null);
});

test('standalone notifications isolate account changes and release streams on shutdown', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const { runtime, state } = fixture(t);
  const res = response();
  runtime.danmakuEvents.open(res, { id: 'danmaku' }, () => 200);
  const update = { ownerScope: state.owner.scope, authorizationEpoch: 1, connectionEpoch: 'first', status: 'connecting' };
  runtime.receiveCloud(update);
  t.mock.timers.tick(40);
  assert.deepEqual(res.writes, ['data: ready\n\n', 'data: change\n\n']);
  state.owner = { scope: 'other-owner', epoch: 2 };
  t.mock.timers.tick(1000);
  assert.equal(res.writes.at(-1), 'data: revoked\n\n');
  assert.equal(res.writableEnded, true);
  const next = response();
  runtime.danmakuEvents.open(next, { id: 'danmaku' }, () => 200);
  runtime.dispose();
  assert.equal(next.destroyed, true);
  assert.equal(next.listenerCount('close'), 0);
  assert.equal(next.listenerCount('error'), 0);
});

test('scene runtime notifies accepted cloud and gift changes only, preserving their return values', t => {
  const { runtime, state } = fixture(t);
  const changes = [];
  runtime.receiveCloudSettings({ ownerScope: state.owner.scope, authorizationEpoch: 1,
    settings: { style: 'spooky', fullscreenDurationSeconds: 6 } });
  t.mock.method(runtime.events, 'notify', change => changes.push(change));
  const update = { ownerScope: state.owner.scope, authorizationEpoch: 1, connectionEpoch: 'connection-1', status: 'connecting' };
  assert.equal(runtime.receiveCloud({ ...update, authorizationEpoch: 0 }), false);
  assert.deepEqual(changes, []);
  assert.equal(runtime.receiveCloud(update), true);
  assert.equal(runtime.receiveCloud({ ...update, status: 'connected', event: { type: 'overlay-state', style: 'bubble',
    state: 'running', liveStatus: 1, liveSessionId: 'live-1', confirmationMessage: '开播' } }), true);
  assert.deepEqual(changes.splice(0), [{ types: ['danmaku'] }, { types: ['danmaku'] }]);
  const display = runtime.readDanmakuDisplay({});
  assert.equal(display.config.style, 'spooky', 'Remote event appearance cannot replace the local profile.');
  assert.equal(display.data.status, 'connected');
  assert.deepEqual(Object.keys(display).sort(), ['config', 'data']);
  const event = { type: 'danmaku', liveSessionId: 'live-1', message: '当前事件' };
  assert.equal(runtime.receiveCloud({ ...update, status: 'connected', event }), true);
  assert.deepEqual(changes.splice(0), [{ types: ['danmaku'] }]);
  assert.equal(runtime.receiveCloud({ ...update, connectionEpoch: 'connection-2' }), true);
  changes.length = 0;
  assert.equal(runtime.receiveCloud({ ...update, status: 'connected', event }), false);
  state.owner = { ...state.owner, epoch: 2 };
  assert.equal(runtime.receiveCloud({ ...update, connectionEpoch: 'connection-2', status: 'connected', event }), false);
  assert.deepEqual(changes, []);

  const gift = { type: 'gift:frame', eventId: 'gift-1', userName: '观众' };
  assert.equal(runtime.receiveGift(gift), true);
  assert.equal(runtime.receiveGift(gift), false);
  assert.equal(runtime.receiveGift({ type: 'gift:effect', eventId: 'effect-1' }), false);
  assert.equal(runtime.receiveGift({ type: 'gift:guard-thanks', eventId: 'guard-1' }), true);
  assert.deepEqual(changes.splice(0), [{ types: ['gift-frame'] }, { types: ['guard-thanks'] }]);
  state.owner = null;
  assert.equal(runtime.receiveGift({ ...gift, eventId: 'gift-2' }), false);
  assert.deepEqual(changes, []);
});

test('unchanged scene gift windows skip cloning while new events and owner resets remain visible', t => {
  const { runtime, state } = fixture(t);
  const source = publish(runtime, ['gift-frame', 'guard-thanks']);
  const input = { ...source, incrementalParts: true };
  for (let i = 0; i < 200; i++) runtime.receiveGift({ type: i % 2 ? 'gift:frame' : 'gift:guard-thanks', eventId: `gift-${i}` });
  const initial = runtime.service.getOutput({ ...input, dataVersions: {} });
  let copied = 0;
  const clone = global.structuredClone;
  t.mock.method(global, 'structuredClone', value => {
    if (Array.isArray(value) && value[0]?.payload) copied += value.length;
    return clone(value);
  });
  for (let i = 0; i < 20; i++) {
    const result = runtime.service.getOutput({ ...input, dataVersions: initial.dataVersions });
    assert.equal(result.data['gift-frame'], undefined);
    assert.equal(result.data['guard-thanks'], undefined);
  }
  assert.equal(copied, 0, 'unrelated scene updates must not copy the retained gift window');
  const legacy = runtime.service.getOutput(source);
  assert.equal(legacy.data['gift-frame'].events.length, 100);
  assert.equal(legacy.data['guard-thanks'].events.length, 100);
  const oldPage = runtime.service.getOutput({ ...source, dataVersions: initial.dataVersions });
  assert.equal(oldPage.data['gift-frame'].events.length, 100, 'old pages acknowledging versions still receive full gift windows');
  assert.equal(oldPage.dataVersions['gift-frame'], undefined);
  runtime.receiveGift({ type: 'gift:frame', eventId: 'new-gift' });
  const changed = runtime.service.getOutput({ ...input, dataVersions: initial.dataVersions });
  assert.equal(changed.data['gift-frame'].events.at(-1).payload.eventId, 'new-gift');
  assert.equal(changed.data['guard-thanks'].events.length, 99, 'the shared window still evicts its oldest event');
  changed.data['gift-frame'].events[0].payload.eventId = 'caller-mutation';
  assert.notEqual(runtime.service.getOutput(source).data['gift-frame'].events[0].payload.eventId, 'caller-mutation');
  state.owner = { ...state.owner, epoch: state.owner.epoch + 1 };
  const reset = runtime.service.getOutput({ ...input, dataVersions: changed.dataVersions });
  assert.notEqual(reset.data['gift-frame'].epoch, changed.data['gift-frame'].epoch);
  assert.equal(reset.data['gift-frame'].events.length, 0);
  assert.equal(reset.data['guard-thanks'].events.length, 0);
});

test('committed publication and capability rotation reach the runtime event service', t => {
  const { runtime } = fixture(t);
  const changes = [];
  t.mock.method(runtime.events, 'notify', change => changes.push(change));
  const source = publish(runtime, 'clock');
  assert.deepEqual(changes.splice(0), [{ id: source.id }]);
  assert.throws(() => runtime.service.publish({ id: source.id, expectedRevision: 999 }), { code: 'SCENE_CONFLICT' });
  assert.deepEqual(changes, []);
  runtime.service.rotate(source.id);
  assert.deepEqual(changes, [{ id: source.id }]);
});

test('scene subscribers receive runtime events without WebSocket clients and disposal cancels pending notifications', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const { runtime } = fixture(t);
  const source = publish(runtime, 'gift-frame');
  const res = response();
  runtime.events.open(res, source, () => 200);
  assert.equal(res.status, 200);
  assert.deepEqual(res.writes, ['data: ready\n\n']);
  assert.equal(runtime.receiveGift({ type: 'gift:frame', eventId: 'gift-1' }), true);
  t.mock.timers.tick(60);
  assert.deepEqual(res.writes, ['data: ready\n\n', 'data: change\n\n']);
  runtime.receiveGift({ type: 'gift:frame', eventId: 'gift-2' });
  runtime.dispose();
  assert.equal(res.destroyed, true);
  assert.equal(res.listenerCount('close'), 0);
  assert.equal(res.listenerCount('error'), 0);
  runtime.notify({ types: ['gift-frame'] });
  t.mock.timers.tick(60);
  assert.equal(res.writes.length, 2);
  assert.throws(() => runtime.events.open(response(), source, () => 200), { statusCode: 503 });
});

test('scene configuration notifications invalidate only requested slow projections', async t => {
  let label = '原许愿';
  let reads = 0;
  const context = { gifts: { getViewRevision: () => 'same-revision' },
    giftWishes: { getSnapshot: async () => { reads++; return { items: [{ label }] }; } } };
  const { runtime } = fixture(t, context);
  const source = publish(runtime, 'gift-wishes');
  const output = () => runtime.service.getOutput(source);
  assert.equal((await output()).data['gift-wishes'].items[0].label, '原许愿');
  label = '新许愿';
  runtime.notify({ types: ['gift-wishes'] });
  assert.equal((await output()).data['gift-wishes'].items[0].label, '原许愿');
  assert.equal(reads, 1);
  const changes = [];
  t.mock.method(runtime.events, 'notify', change => changes.push(change));
  runtime.notify({ types: ['gift-wishes'], invalidateTypes: ['gift-wishes'] });
  assert.deepEqual(changes, [{ types: ['gift-wishes'] }]);
  assert.equal((await output()).data['gift-wishes'].items[0].label, '新许愿');
  assert.equal(reads, 2);
});
