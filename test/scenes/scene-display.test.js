'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCloudDisplayBuffer } = require('../../src/scenes/cloud-display-buffer');
const { createSceneComponentPorts, normalizeSceneConfig } = require('../../src/server/scene-components');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');
const { getClockConfig } = require('../../src/server/clock-contract');
const { createLayout } = require('../../src/shared/danmaku-layout');

const timestamp = '2026-09-30T08:00:00.000Z';
const liveState = (session = 'session-a') => ({ type: 'overlay-state', style: 'signal', state: 'running',
  liveStatus: session ? 1 : 0, liveSessionId: session, confirmationMessage: session ? '开播' : null });
const gift = (name = '观众', session = 'session-a') => ({ type: 'gift', liveSessionId: session, timestamp,
  name, giftName: '灯牌', giftCount: 1 });

function bufferFixture() {
  let owner = { scope: 'scope-a', epoch: 1 };
  let connection = 'connection-a';
  const buffer = createCloudDisplayBuffer({ getOwner: () => owner });
  const update = (status, event, overrides) => buffer.receive({ ownerScope: owner?.scope, authorizationEpoch: owner?.epoch,
    connectionEpoch: connection, status, ...(event ? { event } : {}), ...overrides });
  return {
    buffer, update,
    connect(value = connection, session = 'session-a') {
      connection = value;
      assert.equal(update('connecting'), true);
      assert.equal(update('connected', liveState(session)), true);
      return buffer.getSnapshot();
    },
    setOwner(value) { owner = value; },
  };
}

test('buffer cursor delivers each event once when advanced, independently for multiple scene readers', () => {
  const { buffer, update, connect } = bufferFixture();
  const initial = connect();
  assert.equal(initial.reset, true);
  assert.equal(initial.status, 'connected');
  assert.deepEqual(initial.events, []);
  update('connected', gift('one'));
  update('connected', gift('two'));
  const first = buffer.getSnapshot({ epoch: initial.epoch, cursor: initial.nextCursor });
  assert.equal(first.reset, false);
  assert.equal(first.gap, false);
  assert.equal(first.nextCursor, 2);
  assert.deepEqual(first.events, [gift('one'), gift('two')]);
  assert.deepEqual(buffer.getSnapshot({ epoch: first.epoch, cursor: first.nextCursor }).events, []);
  assert.deepEqual(buffer.getSnapshot({ epoch: initial.epoch, cursor: '0' }).events, first.events);
  update('connected', gift('three'));
  assert.deepEqual(buffer.getSnapshot({ epoch: first.epoch, cursor: first.nextCursor }).events, [gift('three')]);
});

test('bounded 200-event window reports gap and resets to current cursor without replay or compensation', () => {
  const { buffer, update, connect } = bufferFixture();
  const initial = connect();
  for (let index = 1; index <= 202; index++) update('connected', gift(String(index)));
  const gap = buffer.getSnapshot({ epoch: initial.epoch, cursor: 0 });
  assert.equal(gap.gap, true);
  assert.equal(gap.reset, true);
  assert.equal(gap.nextCursor, 202);
  assert.deepEqual(gap.events, []);
  const retained = buffer.getSnapshot({ epoch: initial.epoch, cursor: 2 });
  assert.equal(retained.gap, false);
  assert.equal(retained.events.length, 200);
  assert.equal(retained.events[0].name, '3');
  assert.deepEqual(buffer.getSnapshot({ epoch: gap.epoch, cursor: gap.nextCursor }).events, []);
  update('connected', gift('new'));
  assert.deepEqual(buffer.getSnapshot({ epoch: gap.epoch, cursor: gap.nextCursor }).events, [gift('new')]);
});

test('foreign epochs and malformed cursors reset without treating missing/boolean cursors as zero', () => {
  const { buffer, update, connect } = bufferFixture();
  const initial = connect();
  update('connected', gift());
  for (const cursor of [undefined, null, '', false, true, [], {}, -1, 0.5, 2, NaN, Infinity, '1e0', '0x0']) {
    const snapshot = buffer.getSnapshot({ epoch: initial.epoch, cursor });
    assert.equal(snapshot.reset, true, String(cursor));
    assert.deepEqual(snapshot.events, []);
  }
  const foreign = buffer.getSnapshot({ epoch: 'old-epoch', cursor: 0 });
  assert.equal(foreign.reset, true);
  assert.equal(foreign.gap, false);
  assert.deepEqual(foreign.events, []);
});

test('logout and same-owner authorization renewal clear appearance, state and event buffers', () => {
  const fixture = bufferFixture();
  const initial = fixture.connect();
  fixture.update('connected', gift());
  fixture.setOwner(null);
  const loggedOut = fixture.buffer.getSnapshot({ epoch: initial.epoch, cursor: 0 });
  assert.equal(loggedOut.status, 'offline');
  assert.equal(loggedOut.state, null);
  assert.equal(fixture.buffer.getSettings(), null);
  assert.equal(fixture.update('connected', gift(), { ownerScope: 'scope-a', authorizationEpoch: 1 }), false);
  fixture.setOwner({ scope: 'scope-a', epoch: 2 });
  const renewed = fixture.buffer.getSnapshot();
  assert.notEqual(renewed.epoch, initial.epoch);
  assert.equal(fixture.update('connected', liveState(), { authorizationEpoch: 1 }), false);
  assert.equal(fixture.buffer.getSettings(), null);
  fixture.connect('connection-b');
  fixture.setOwner({ scope: 'scope-b', epoch: 2 });
  assert.equal(fixture.buffer.getSnapshot().state, null);
  assert.equal(fixture.buffer.getSettings(), null);
});

test('new connection requires state and ignores stale connection events or disconnects', () => {
  const fixture = bufferFixture();
  const initial = fixture.connect();
  assert.equal(fixture.update('connecting'), false);
  assert.equal(fixture.update('connected', liveState()), false);
  assert.equal(fixture.buffer.getSnapshot().epoch, initial.epoch);
  assert.equal(fixture.update('connecting', null, { connectionEpoch: 'connection-b' }), true);
  const reconnect = fixture.buffer.getSnapshot();
  assert.equal(reconnect.status, 'connecting');
  assert.notEqual(reconnect.epoch, initial.epoch);
  assert.equal(fixture.update('connected', gift()), false);
  assert.equal(fixture.update('offline'), false);
  assert.equal(fixture.update('connected', gift(), { connectionEpoch: 'connection-b' }), false);
  assert.equal(fixture.update('connected', liveState(), { connectionEpoch: 'connection-b' }), true);
  assert.equal(fixture.update('offline', null, { connectionEpoch: 'connection-b' }), true);
  const disconnected = fixture.buffer.getSnapshot();
  assert.equal(disconnected.status, 'offline');
  assert.equal(disconnected.state, null);
  assert.equal(fixture.update('connected', liveState(), { connectionEpoch: 'connection-b' }), false);
});

test('live-session boundaries reset cursors and reject duplicate starts, wrong ends and old events', () => {
  const fixture = bufferFixture();
  const initial = fixture.connect('connection-a', null);
  assert.equal(fixture.update('connected', gift()), false);
  const start = { type: 'live-started', liveSessionId: 'session-a', message: '开播', timestamp };
  assert.equal(fixture.update('connected', start), true);
  const active = fixture.buffer.getSnapshot();
  assert.notEqual(active.epoch, initial.epoch);
  assert.equal(fixture.update('connected', start), false);
  assert.equal(fixture.buffer.getSnapshot().epoch, active.epoch);
  fixture.update('connected', gift());
  assert.equal(fixture.update('connected', { type: 'live-ended', liveSessionId: 'other', timestamp }), false);
  assert.equal(fixture.update('connected', { type: 'live-ended', liveSessionId: 'session-a', timestamp }), true);
  const ended = fixture.buffer.getSnapshot();
  assert.equal(ended.state.liveSessionId, null);
  assert.equal(ended.nextCursor, 0);
  assert.deepEqual(ended.events, []);
  assert.equal(fixture.update('connected', gift()), false);
  assert.equal(fixture.update('connected', { ...start, liveSessionId: 'session-b' }), true);
  assert.equal(fixture.update('connected', gift('new', 'session-b')), true);
});

test('only display fields leave the buffer, snapshots and appearance cannot mutate internal state', () => {
  const fixture = bufferFixture();
  fixture.update('connecting');
  const state = { ...liveState(), token: 'PRIVATE', raw: { cookie: 'PRIVATE' }, styleOptions: { signal: { fontSize: 30 } } };
  assert.equal(fixture.update('connected', state), true);
  state.styleOptions.signal.fontSize = 40;
  assert.equal(fixture.buffer.getSettings().styleOptions.signal.fontSize, 30);
  const initial = fixture.buffer.getSnapshot();
  fixture.update('connected', { ...gift(), uid: 'PRIVATE', capability: 'PRIVATE', raw: { cookie: 'PRIVATE' } });
  fixture.update('connected', { type: 'danmaku', liveSessionId: 'session-a', timestamp, name: '观众', message: '内容',
    avatarUrl: '', medalName: '', medalLevel: 0, guardLevel: 0, isStreamer: true,
    emotes: [{ text: '表情', url: 'https://i0.hdslb.com/emote.png', kind: 'inline', width: 30, height: 30, cookie: 'PRIVATE' }] });
  fixture.update('connected', { type: 'superchat', liveSessionId: 'session-a', timestamp, name: '观众', message: '原文\n内容',
    avatarUrl: '', price: 2, colors: { priceColor: '#123456', cookie: 'PRIVATE' }, uid: 'PRIVATE' });
  const snapshot = fixture.buffer.getSnapshot({ epoch: initial.epoch, cursor: 0 });
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE|cookie|capability|uid/);
  assert.equal(snapshot.events.length, 3);
  assert.equal(snapshot.events[2].message, '原文\n内容');
  snapshot.events[0].giftName = 'changed';
  snapshot.events[1].emotes[0].url = 'changed';
  snapshot.state.confirmationMessage = 'changed';
  const settings = fixture.buffer.getSettings();
  settings.styleOptions.signal.fontSize = 48;
  const again = fixture.buffer.getSnapshot({ epoch: initial.epoch, cursor: 0 });
  assert.equal(again.events[0].giftName, '灯牌');
  assert.equal(again.events[1].emotes[0].url, 'https://i0.hdslb.com/emote.png');
  assert.equal(again.state.confirmationMessage, '开播');
  assert.equal(fixture.buffer.getSettings().styleOptions.signal.fontSize, 30);
});

test('cloud appearance update changes only the default cache, not state epoch or event cursor', () => {
  const fixture = bufferFixture();
  const initial = fixture.connect();
  fixture.update('connected', gift());
  const before = fixture.buffer.getSnapshot();
  assert.equal(fixture.update('connected', { type: 'overlay-settings', style: 'glow', fullscreenDurationSeconds: 12,
    styleOptions: {}, layout: createLayout(), timestamp, overlayUrl: 'PRIVATE' }), true);
  const after = fixture.buffer.getSnapshot({ epoch: initial.epoch, cursor: 0 });
  assert.equal(after.epoch, before.epoch);
  assert.equal(after.nextCursor, before.nextCursor);
  assert.deepEqual(after.events, [gift()]);
  assert.equal(fixture.buffer.getSettings().style, 'glow');
  assert.equal(fixture.update('connected', { type: 'overlay-settings', style: 'signal', styleOptions: { signal: { cookie: 'PRIVATE' } } }), false);
  assert.equal(fixture.buffer.getSettings().style, 'glow');
  assert.doesNotMatch(JSON.stringify(fixture.buffer.getSettings()), /PRIVATE/);
});

function componentFixture() {
  let state = {
    settings: { ...DEFAULT_SETTINGS, deviceToken: 'PRIVATE', roomId: 'PRIVATE', clockStyle: 'flip' },
    queue: { current: { song_name: '歌曲', requester_name: '听众', userId: 'PRIVATE' },
      waiting: [{ song_name: '待唱', requester_name: '听众', secret: 'PRIVATE' }], privateQueueData: 'PRIVATE' },
    superChats: [{ message: '原文', price: 2, uid: 'PRIVATE' }],
    overtime: { revision: 2, status: 'running', serverNowMs: 1000, effectiveRemainingMs: 60000,
      background: { path: '', fit: 'contain' }, secret: 'PRIVATE', ledger: ['PRIVATE'],
      rules: [{ enabled: true, giftId: '1', giftName: '灯牌', imagePath: '', mode: 'fixed', fixedSeconds: 60,
        fixedEffect: { operation: 'add', value: 60, secret: 'PRIVATE' }, outcomes: ['PRIVATE'], actor: 'PRIVATE' }] },
    danmakuFeed: [{ name: 'LOCAL_MUST_NOT_APPEAR', message: 'local feed' }],
  };
  const cloudFixture = bufferFixture();
  let reads = 0;
  const ports = createSceneComponentPorts({ getState: () => { reads++; return state; }, cloud: cloudFixture.buffer });
  return { ports, cloudFixture, get state() { return state; }, setState(value) { state = value; }, get reads() { return reads; } };
}

test('display projection includes only requested types and required display fields, never local danmaku fallback', () => {
  const fixture = componentFixture();
  const initial = fixture.cloudFixture.connect();
  fixture.cloudFixture.update('connected', gift());
  const data = fixture.ports.getDisplayData(['clock', 'queue', 'queue', 'overtime', 'danmaku'], { epoch: initial.epoch, cursor: 0 });
  assert.equal(fixture.reads, 1);
  assert.deepEqual(Object.keys(data).sort(), ['danmaku', 'overtime', 'queue']);
  assert.deepEqual(data.queue.queue.current, { song_name: '歌曲', requester_name: '听众' });
  assert.deepEqual(data.queue.superChats, [{ message: '原文', price: 2 }]);
  assert.equal(data.overtime.effectiveRemainingMs, 60000);
  assert.equal(Object.hasOwn(data.overtime, 'background'), false);
  assert.deepEqual(data.overtime.rules[0].fixedEffect, { operation: 'add', value: 60 });
  assert.deepEqual(data.danmaku.events, [gift()]);
  assert.doesNotMatch(JSON.stringify(data), /PRIVATE|LOCAL_MUST_NOT_APPEAR|deviceToken|roomId/);
  data.queue.queue.current.song_name = 'changed';
  assert.equal(fixture.state.queue.current.song_name, '歌曲');
  assert.deepEqual(Object.keys(fixture.ports.getDisplayData(['queue'], {})), ['queue']);
  assert.deepEqual(fixture.ports.getDisplayData([], {}), {});
});

test('component defaults are complete isolated appearance copies and cloud unavailable fails explicitly', () => {
  const fixture = componentFixture();
  assert.deepEqual(fixture.ports.getDefaultConfig('clock'), getClockConfig(fixture.state.settings));
  const queue = fixture.ports.getDefaultConfig('queue');
  assert.equal(queue.overlayQueueStyle, 'classic');
  assert.equal(queue.queueSongFontSize, '28');
  assert.equal(Object.hasOwn(queue, 'deviceToken'), false);
  assert.equal(Object.hasOwn(queue, 'roomId'), false);
  assert.deepEqual(fixture.ports.getDefaultConfig('overtime'), { path: '', fit: 'contain' });
  assert.throws(() => fixture.ports.getDefaultConfig('danmaku'), { code: 'SCENE_DEFAULT_UNAVAILABLE', statusCode: 503 });
  fixture.cloudFixture.connect();
  const danmaku = fixture.ports.getDefaultConfig('danmaku');
  assert.equal(danmaku.style, 'signal');
  assert.equal(danmaku.fullscreenDurationSeconds, 6);
  assert.deepEqual(danmaku.layout, createLayout());
  fixture.cloudFixture.update('connected', { type: 'overlay-settings', style: 'glow', timestamp });
  assert.equal(danmaku.style, 'signal');
  assert.equal(fixture.ports.getDefaultConfig('danmaku').style, 'glow');
  assert.throws(() => fixture.ports.getDefaultConfig('private'), { code: 'INVALID_SCENE_CONFIG' });
});

test('appearance normalization rejects private keys, nested objects, nonfinite values and unsafe backgrounds', () => {
  const clock = getClockConfig(DEFAULT_SETTINGS);
  const danmaku = { style: 'signal', fullscreenDurationSeconds: 6, styleOptions: {}, layout: null };
  for (const [type, config] of [
    ['clock', { ...clock, deviceToken: 'PRIVATE' }], ['clock', { ...clock, label: { cookie: 'PRIVATE' } }],
    ['clock', { ...clock, showDate: [] }], ['clock', { ...clock, style: 'invalid' }],
    ['queue', { cookie: 'PRIVATE' }], ['queue', { overlayTitle: { secret: 'PRIVATE' } }],
    ['queue', { queueSongFontSize: Infinity }], ['queue', { overlayQueueStyle: 'unknown' }],
    ['overtime', { path: 'file:///C:/private.png', fit: 'cover' }],
    ['overtime', { path: 'https://evil.test/image.png?token=PRIVATE', fit: 'cover' }],
    ['overtime', { path: { cookie: 'PRIVATE' }, fit: 'cover' }], ['overtime', { path: '', fit: 'cover', remainingSeconds: 1 }],
    ['danmaku', { ...danmaku, liveSessionId: 'PRIVATE' }], ['danmaku', { ...danmaku, styleOptions: false }],
    ['danmaku', { ...danmaku, styleOptions: { signal: { token: 'PRIVATE' } } }],
    ['danmaku', { ...danmaku, layout: { ...createLayout(), token: 'PRIVATE' } }],
    ['queue', JSON.parse('{"__proto__":{"token":"PRIVATE"}}')],
  ]) assert.throws(() => normalizeSceneConfig(type, config), { code: 'INVALID_SCENE_CONFIG', statusCode: 400 }, type);
  assert.deepEqual(normalizeSceneConfig('clock', clock), clock);
  assert.deepEqual(normalizeSceneConfig('overtime', { path: '', fit: 'contain' }), { path: '', fit: 'contain' });
  assert.equal(normalizeSceneConfig('queue', {}).queueSongFontSize, '28');
  assert.equal(normalizeSceneConfig('queue', { overlayQueueStyle: 'festival' }).overlayQueueStyle, 'festival');
});
