'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSceneCloudController, getSceneOwner } = require('../../src/electron/scene-cloud-controller');
const { createCloudDisplayBuffer } = require('../../src/scenes/cloud-display-buffer');
const { readBoundedSse } = require('../../src/shared/bounded-sse-reader');

const OVERLAY_URL = 'https://stream.example.test/overlay/abcdefghijklmnop';
const TIMESTAMP = '2026-09-30T08:00:00.000Z';
const state = (liveSessionId = 'session-a') => ({
  type: 'overlay-state', style: 'signal', state: 'running', liveStatus: liveSessionId ? 1 : 0,
  liveSessionId, confirmationMessage: liveSessionId ? '开始直播' : null,
});
const gift = (liveSessionId = 'session-a') => ({
  type: 'gift', liveSessionId, timestamp: TIMESTAMP, name: '星河来客', giftName: '灯牌', giftCount: 2,
});
const frame = (event) => `event: overlay-event\r\ndata: ${JSON.stringify(event)}\r\n\r\n`;
const flush = () => new Promise((resolve) => setImmediate(resolve));

function stream() {
  let writer;
  let cancelled = 0;
  const response = new Response(new ReadableStream({
    start(controller) { writer = controller; },
    cancel() { cancelled++; },
  }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
  return {
    response,
    get cancelled() { return cancelled; },
    bytes(value) { writer.enqueue(value); },
    send(event) { writer.enqueue(Buffer.from(frame(event))); },
    close() { writer.close(); },
    fail() { writer.error(new Error(`${OVERLAY_URL}?token=PRIVATE_FAILURE`)); },
  };
}

function fixture(t, options = {}) {
  const updates = [];
  const requests = [];
  const streams = [];
  const listeners = new Set();
  const demandListeners = new Set();
  const tasks = new Map();
  let timerId = 0;
  let settingsReads = 0;
  const identity = { authorized: true, streamerId: 7, epoch: 1, origin: 'https://api.example.test' };
  const licenseManager = {
    isAuthorized: () => identity.authorized,
    getCloudSyncIdentity: () => {
      assert.equal(identity.authorized, true);
      return { streamerId: identity.streamerId };
    },
    getAuthorizationEpoch: () => {
      assert.equal(identity.authorized, true);
      return identity.epoch;
    },
    getRemoteBaseUrl: () => identity.origin,
    getOverlaySettings: () => {
      settingsReads++;
      return options.getSettings?.() ?? Promise.resolve({ overlayUrl: OVERLAY_URL });
    },
    onStateChanged: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    getAccessToken: () => assert.fail('must not read device credentials'),
  };
  const controller = createSceneCloudController({
    licenseManager,
    subscribeDemand(listener) {
      demandListeners.add(listener);
      listener(options.demanded !== false);
      return () => demandListeners.delete(listener);
    },
    publish: (update) => { updates.push(update); options.onPublish?.(update); },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (options.fetchImpl) return options.fetchImpl(url, init);
      const source = stream();
      streams.push(source);
      return source.response;
    },
    timers: {
      setTimeout(callback, delay) { const id = ++timerId; tasks.set(id, { callback, delay }); return id; },
      clearTimeout(id) { tasks.delete(id); },
    },
  });
  t.after(() => controller.stop());
  return {
    controller, updates, requests, streams, identity, listeners, tasks, demandListeners,
    demand(active) { for (const listener of demandListeners) listener(active); },
    get settingsReads() { return settingsReads; },
    events: () => updates.filter((update) => update.event).map((update) => update.event),
    change(patch) { Object.assign(identity, patch); for (const listener of listeners) listener(); },
    fire(delay) {
      const entry = [...tasks].find(([, task]) => task.delay === delay);
      assert.ok(entry, `missing timer with delay ${delay}`);
      tasks.delete(entry[0]);
      entry[1].callback();
    },
  };
}

test('idle desktops make no upstream requests and active readers share one cancellable connection', async (t) => {
  const buffer = createCloudDisplayBuffer({ getOwner: () => ({
    scope: '["https://api.example.test","7"]', epoch: env.identity.epoch,
  }) });
  const env = fixture(t, { demanded: false, onPublish: update => buffer.receive(update) });
  env.controller.start();
  env.change({ epoch: 2 });
  await flush();
  assert.equal(env.settingsReads, 0);
  assert.equal(env.requests.length, 0);
  assert.equal(env.tasks.size, 0);
  env.demand(true);
  env.demand(true);
  await flush();
  assert.equal(env.requests.length, 1);
  env.streams[0].send(state());
  env.streams[0].send(gift());
  await flush();
  const connected = buffer.getSnapshot();
  assert.equal(connected.nextCursor, 1);
  env.demand(false);
  await env.controller.whenIdle();
  assert.equal(env.requests[0].init.signal.aborted, true);
  assert.equal(env.streams[0].cancelled, 1);
  assert.equal(env.updates.at(-1).status, 'offline');
  const idle = buffer.getSnapshot({ epoch: connected.epoch, cursor: 0 });
  assert.equal(idle.status, 'offline');
  assert.equal(idle.state, null);
  assert.deepEqual(idle.events, []);
  assert.equal(buffer.getSettings().style, 'signal', 'Idle cleanup retains appearance settings.');
  assert.equal(env.tasks.size, 0, 'No retries remain when the display is unused.');
  env.demand(true);
  await flush();
  assert.equal(env.requests.length, 2);
  env.controller.stop();
  await env.controller.whenIdle();
  assert.equal(env.listeners.size, 0);
  assert.equal(env.demandListeners.size, 0);
  assert.equal(env.tasks.size, 0);
});

test('demand ending during settings lookup discards the late result and cancels retry backoff', async (t) => {
  let resolveSettings;
  const env = fixture(t, { getSettings: () => new Promise(resolve => { resolveSettings = resolve; }) });
  env.controller.start();
  env.demand(false);
  resolveSettings({ overlayUrl: OVERLAY_URL });
  await env.controller.whenIdle();
  assert.equal(env.requests.length, 0);
  assert.equal(env.tasks.size, 0);
  env.demand(true);
  resolveSettings({ overlayUrl: OVERLAY_URL });
  await flush();
  env.streams[0].fail();
  await flush();
  assert.ok([...env.tasks.values()].some(task => task.delay === 1000));
  env.demand(false);
  assert.equal(env.tasks.size, 0);
  env.change({ authorized: false });
  env.demand(true);
  await flush();
  assert.equal(env.requests.length, 1, 'Demand cannot bypass authorization.');
});

test('one public connection preserves split UTF-8/CRLF events and strips non-display fields', async (t) => {
  const env = fixture(t);
  env.controller.start();
  env.controller.start();
  await flush();
  assert.equal(env.listeners.size, 1);
  assert.equal(env.requests.length, 1);
  const { url, init } = env.requests[0];
  assert.equal(url, 'https://stream.example.test/api/public/overlay/events?token=abcdefghijklmnop');
  assert.equal(init.redirect, 'error');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.deepEqual(init.headers, { Accept: 'text/event-stream' });
  assert.equal(init.body, undefined);
  assert.equal(env.updates.at(-1).status, 'connecting');
  const wire = Buffer.from(`\uFEFFretry: 3000\r\n\r\n: keep-alive\r\n\r\n${frame(state())}${frame({
    ...gift(), token: 'PRIVATE', uid: 123, raw: { cookie: 'PRIVATE' }, streamerId: 888,
  })}`);
  for (const byte of wire) env.streams[0].bytes(Uint8Array.of(byte));
  await flush();
  assert.deepEqual(env.events(), [state(), gift()]);
  assert.equal(env.updates.at(-1).status, 'connected');
  assert.equal(env.updates.at(-1).ownerScope, JSON.stringify(['https://api.example.test', '7']));
  assert.equal(env.updates.at(-1).authorizationEpoch, 1);
  assert.equal(JSON.stringify(env.updates).includes('PRIVATE'), false);
});

test('all eight protocol types keep live-session ordering and only appearance allowlists', async (t) => {
  const env = fixture(t);
  env.controller.start();
  await flush();
  const source = env.streams[0];
  const events = [
    state(null),
    { type: 'live-started', liveSessionId: 'session-a', timestamp: TIMESTAMP, message: '开始' },
    { type: 'danmaku', liveSessionId: 'session-a', timestamp: TIMESTAMP, name: '观众', message: '[喝彩]',
      avatarUrl: '', guardLevel: 3, medalName: '', medalLevel: 1, isStreamer: true,
      emotes: [{ text: '[喝彩]', url: 'https://i0.hdslb.com/bfs/emote/cheer.png', width: 192, height: 192, kind: 'inline' }] },
    { ...gift(), giftTotalPrice: 2.5, giftImageUrl: 'https://i0.hdslb.com/bfs/gift.png',
      avatarUrl: 'https://i0.hdslb.com/bfs/face.png', giftGuardLevel: 3, guardAction: 'renew', guardAccompanyDays: 360 },
    { type: 'entry', liveSessionId: 'session-a', timestamp: TIMESTAMP, name: '进房观众', guardLevel: 3 },
    { type: 'superchat', liveSessionId: 'session-a', timestamp: TIMESTAMP, name: '观众', message: '  原文\n不截断  ',
      price: 2, avatarUrl: '', colors: { priceColor: '#7497CD' } },
    { type: 'overlay-settings', style: 'bubble', timestamp: TIMESTAMP, fullscreenDurationSeconds: 12,
      styleOptions: { bubble: { fontSize: 30, textColor: '#eaf2ff' } }, layout: null },
    { type: 'live-ended', liveSessionId: 'session-a', timestamp: TIMESTAMP },
    { type: 'live-started', liveSessionId: 'session-b', timestamp: TIMESTAMP, message: '新场次' },
    gift('session-b'),
  ];
  for (const event of events) source.send({ ...event, overlayUrl: OVERLAY_URL, accessToken: 'PRIVATE' });
  await flush();
  assert.deepEqual(env.events(), events);
});

test('prismatic identity passes only official display fields without reusing an equipped medal guard', async (t) => {
  const env = fixture(t);
  env.controller.start();
  await flush();
  const event = { type: 'danmaku', liveSessionId: 'session-a', timestamp: TIMESTAMP,
    name: '观众', message: '晚上好', avatarUrl: '', emotes: [],
    guardLevel: 1, medalName: '其他房间', medalLevel: 60,
    honorLevel: 45, roomGuardLevel: 0,
    roomMedal: { name: '当前房间', level: 28, guardLevel: 0, isLight: true,
      colorStart: '#3FB4F699', colorEnd: '#3FB4F699', colorBorder: '#5FC7F4', colorText: '#FFFFFF' } };
  env.streams[0].send(state());
  env.streams[0].send({ ...event, roomMedal: { ...event.roomMedal, ruid: 999, token: 'PRIVATE' } });
  env.streams[0].send({ ...gift(), honorLevel: 81, roomGuardLevel: 3, roomMedal: event.roomMedal });
  await flush();
  assert.deepEqual(env.events(), [state(), event, { ...gift(), honorLevel: 81 }]);
  assert.equal(JSON.stringify(env.updates).includes('PRIVATE'), false);
  const unknownLighting = { ...event, roomMedal: { ...event.roomMedal } };
  delete unknownLighting.roomMedal.isLight;
  env.streams[0].send(unknownLighting);
  await flush();
  assert.deepEqual(env.events().at(-1), unknownLighting);
});

for (const patch of [
  { honorLevel: 0 }, { honorLevel: Number.MAX_SAFE_INTEGER + 1 }, { roomGuardLevel: 4 },
  { roomMedal: null },
  { roomMedal: { name: '粉丝团', level: 1, guardLevel: 3, isLight: 1 } },
  { roomMedal: { name: '粉丝团', level: 1, guardLevel: 3, isLight: true, colorStart: 'url(https://x.test)' } },
]) {
  test(`invalid optional identity is rejected: ${JSON.stringify(patch)}`, async (t) => {
    const env = fixture(t);
    env.controller.start();
    await flush();
    env.streams[0].send(state());
    env.streams[0].send({ type: 'danmaku', liveSessionId: 'session-a', timestamp: TIMESTAMP,
      name: '观众', message: '你好', avatarUrl: '', emotes: [], guardLevel: 0, medalName: '', medalLevel: 0,
      ...patch });
    await flush();
    assert.deepEqual(env.events(), [state()]);
    assert.equal(env.updates.at(-1).status, 'offline');
  });
}

test('disconnect resets before reconnect, new connection requires a new state and epoch', async (t) => {
  const env = fixture(t);
  env.controller.start();
  await flush();
  env.streams[0].send(state());
  env.streams[0].send(gift());
  await flush();
  const epoch = env.updates.at(-1).connectionEpoch;
  env.streams[0].close();
  await flush();
  assert.equal(env.updates.at(-1).status, 'offline');
  assert.equal(env.updates.at(-1).event, undefined);
  assert.equal(env.updates.at(-1).connectionEpoch, epoch);
  env.fire(1000);
  await flush();
  assert.notEqual(env.updates.at(-1).connectionEpoch, epoch);
  assert.equal(env.updates.at(-1).status, 'connecting');
  assert.equal(env.settingsReads, 2);
  env.streams[1].send(state(null));
  await flush();
  assert.deepEqual(env.events(), [state(), gift(), state(null)]);
  assert.equal(env.streams[0].response.body.locked, false);
});

for (const [name, events] of [
  ['event before initial state', [gift()]],
  ['settings before initial state', [{ type: 'overlay-settings', style: 'signal', timestamp: TIMESTAMP }]],
  ['duplicate state', [state(), state()]],
  ['different session', [state(), gift('other-session')]],
  ['event without live session', [state(null), gift()]],
  ['duplicate live-started', [state(), { type: 'live-started', liveSessionId: 'session-a', message: '开始', timestamp: TIMESTAMP }]],
  ['inconsistent confirmation', [{ ...state(), confirmationMessage: null }]],
  ['event after live-ended', [state(), { type: 'live-ended', liveSessionId: 'session-a', timestamp: TIMESTAMP }, gift()]],
  ['private event type', [state(), { type: 'gift-event', cookie: 'PRIVATE' }]],
  ['invalid appearance', [state(), { type: 'overlay-settings', style: 'signal', timestamp: TIMESTAMP, styleOptions: { signal: { token: 'PRIVATE' } } }]],
  ['invalid nested image', [state(), { ...gift(), giftImageUrl: 'https://user:PRIVATE@i0.hdslb.com/image.png' }]],
  ['invalid gift avatar', [state(), { ...gift(), avatarUrl: 'https://untrusted.test/image.png' }]],
  ['invalid purchased rank', [state(), { ...gift(), giftGuardLevel: 4 }]],
  ['invalid guard action', [state(), { ...gift(), giftGuardLevel: 3, guardAction: 'guess' }]],
  ['invalid companion days', [state(), { ...gift(), giftGuardLevel: 3, guardAccompanyDays: -1 }]],
  ['fractional companion days', [state(), { ...gift(), giftGuardLevel: 3, guardAccompanyDays: 1.5 }]],
  ['guard metadata on ordinary gift', [state(), { ...gift(), guardAccompanyDays: 360 }]],
]) {
  test(`rejects ${name} and resets with safe status`, async (t) => {
    const env = fixture(t);
    env.controller.start();
    await flush();
    for (const event of events) env.streams[0].send(event);
    await flush();
    assert.equal(env.events().length, events.length - 1);
    assert.equal(env.updates.at(-1).status, 'offline');
    assert.equal(env.updates.at(-1).event, undefined);
    assert.equal(JSON.stringify(env.updates).includes('PRIVATE'), false);
    assert.equal(env.streams[0].cancelled, 1);
    assert.equal(env.streams[0].response.body.locked, false);
  });
}

test('identity/server/authorization epoch changes abort old streams; logout clears and stops retries', async (t) => {
  const env = fixture(t);
  env.controller.start();
  await flush();
  const epochs = new Set();
  for (const patch of [{ streamerId: 8 }, { origin: 'https://other.example.test' }, { epoch: 2 }]) {
    const previous = env.streams.at(-1);
    previous.send(state());
    await flush();
    epochs.add(env.updates.at(-1).connectionEpoch);
    env.change(patch);
    await flush();
    assert.equal(previous.cancelled, 1);
    assert.equal(previous.response.body.locked, false);
    assert.equal(env.updates.at(-1).status, 'connecting');
  }
  epochs.add(env.updates.at(-1).connectionEpoch);
  assert.equal(epochs.size, 4);
  const currentRequest = env.requests.at(-1);
  env.change({ authorized: false });
  await flush();
  assert.equal(currentRequest.init.signal.aborted, true);
  assert.equal(env.tasks.size, 0);
  assert.deepEqual(Object.keys(env.updates.at(-1)).sort(), ['authorizationEpoch', 'connectionEpoch', 'ownerScope', 'status']);
  assert.equal(env.updates.at(-1).ownerScope, null);
  assert.equal(env.updates.at(-1).authorizationEpoch, null);
  env.change({ authorized: true, epoch: 3 });
  await flush();
  assert.equal(env.requests.length, 5);
  env.change({});
  assert.equal(env.requests.length, 5);
});

test('late settings and fetch responses cannot publish into replacement accounts', async (t) => {
  let resolveSettings;
  let settings = new Promise((resolve) => { resolveSettings = resolve; });
  let resolveResponse;
  const response = new Promise((resolve) => { resolveResponse = resolve; });
  const env = fixture(t, { getSettings: () => settings, fetchImpl: () => response });
  env.controller.start();
  env.change({ streamerId: 8, epoch: 2 });
  settings = Promise.resolve({ overlayUrl: OVERLAY_URL });
  resolveSettings({ overlayUrl: OVERLAY_URL });
  await flush();
  assert.equal(env.requests.length, 1);
  env.change({ authorized: false });
  const count = env.updates.length;
  const late = stream();
  resolveResponse(late.response);
  await flush();
  assert.equal(env.updates.length, count);
  assert.equal(late.cancelled, 1);
  assert.equal(env.tasks.size, 0);
});

test('silent authorization changes fence buffered callbacks even without a notification', async (t) => {
  const env = fixture(t);
  env.controller.start();
  await flush();
  env.identity.authorized = false;
  env.streams[0].send(state());
  await flush();
  assert.deepEqual(env.events(), []);
  assert.equal(env.updates.at(-1).ownerScope, null);
  assert.equal(env.tasks.size, 0);
});

test('stop is idempotent, cancels blocked reads and permits a clean restart', async (t) => {
  const env = fixture(t);
  env.controller.start();
  await flush();
  env.controller.stop();
  const count = env.updates.length;
  env.controller.stop();
  await flush();
  assert.equal(env.updates.length, count);
  assert.equal(env.listeners.size, 0);
  assert.equal(env.tasks.size, 0);
  assert.equal(env.streams[0].cancelled, 1);
  assert.equal(env.streams[0].response.body.locked, false);
  assert.equal(env.requests[0].init.signal.aborted, true);
  env.controller.start();
  await flush();
  assert.equal(env.requests.length, 2);
  assert.equal(env.listeners.size, 1);
});

test('retries use bounded backoff and stalled first-state/idle reads are aborted', async (t) => {
  const env = fixture(t);
  env.controller.start();
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    await flush();
    env.fire(15000);
    await flush();
    assert.equal(env.updates.at(-1).status, 'offline');
    assert.equal(env.tasks.size, 1);
    env.fire(delay);
  }
  await flush();
  env.streams.at(-1).send(state());
  await flush();
  env.fire(45000);
  await flush();
  assert.equal(env.updates.at(-1).status, 'offline');
  env.fire(1000);
  await flush();
  assert.equal(env.updates.at(-1).status, 'connecting');
});

for (const invalidUrl of [
  'http://stream.example.test/overlay/abcdefghijklmnop',
  'https://user:PRIVATE@stream.example.test/overlay/abcdefghijklmnop',
  `${OVERLAY_URL}?token=PRIVATE`, `${OVERLAY_URL}#PRIVATE`,
  'https://127.0.0.1/overlay/abcdefghijklmnop',
  'https://stream.example.test/api/device/cloud-state',
  'https://stream.example.test/overlay/short',
]) {
  test(`rejects untrusted overlay URL shape ${invalidUrl.replace(/PRIVATE/g, 'fixture')}`, async (t) => {
    const env = fixture(t, { getSettings: () => ({ overlayUrl: invalidUrl }) });
    env.controller.start();
    await flush();
    assert.equal(env.requests.length, 0);
    assert.equal(env.updates.at(-1).status, 'offline');
    assert.equal(JSON.stringify(env.updates).includes('PRIVATE'), false);
  });
}

test('rejects redirects, unexpected final URL, HTTP errors and non-SSE with body cancellation', async (t) => {
  for (const kind of ['redirect', 'final-url', 'http', 'content-type']) {
    let cancelled = 0;
    const response = new Response(new ReadableStream({ cancel() { cancelled++; } }), {
      status: kind === 'http' ? 403 : kind === 'redirect' ? 302 : 200,
      headers: { 'content-type': kind === 'content-type' ? 'application/json' : 'text/event-stream', Location: 'https://other.example.test' },
    });
    if (kind === 'final-url') Object.defineProperty(response, 'url', { value: 'https://other.example.test/' });
    const env = fixture(t, { fetchImpl: () => response });
    env.controller.start();
    await flush();
    assert.equal(env.updates.at(-1).status, 'offline', kind);
    assert.equal(cancelled, 1, kind);
    assert.deepEqual(env.events(), []);
    env.controller.stop();
  }
});

test('network and stream failures never publish error messages or token URLs', async (t) => {
  const env = fixture(t);
  env.controller.start();
  await flush();
  env.streams[0].fail();
  await flush();
  assert.equal(env.updates.at(-1).status, 'offline');
  const failed = fixture(t, { fetchImpl: () => { throw new Error(`${OVERLAY_URL} PRIVATE_FAILURE`); } });
  failed.controller.start();
  await flush();
  assert.equal(failed.updates.at(-1).status, 'offline');
  assert.doesNotMatch(JSON.stringify([...env.updates, ...failed.updates]), /PRIVATE_FAILURE|abcdefghijklmnop|overlay\//);
});

test('UTF-8 oversized unfinished event is cancelled without delivery; many bounded events in one chunk succeed', async (t) => {
  const env = fixture(t);
  env.controller.start();
  await flush();
  env.streams[0].bytes(Buffer.from(`data: ${'字'.repeat(23000)}`));
  await flush();
  assert.equal(env.updates.at(-1).status, 'offline');
  assert.equal(env.streams[0].cancelled, 1);
  assert.equal(env.streams[0].response.body.locked, false);
  assert.deepEqual(env.events(), []);
  env.fire(1000);
  await flush();
  env.streams[1].bytes(Buffer.from(frame(state()) + frame(gift()).repeat(1000)));
  await flush();
  assert.equal(env.events().length, 1001);
  assert.equal(env.updates.at(-1).status, 'connected');
});

test('shared reader accepts exactly 64 KiB, drops unfinished EOF and releases on callback failure/abort', async () => {
  const blocks = [];
  await readBoundedSse(new Response(`${'x'.repeat(65536)}\n\nunfinished`), {
    onOpen() {}, onBlock: (block) => blocks.push(block), createLimitError: () => new Error('limit'),
  });
  assert.deepEqual(blocks, ['x'.repeat(65536)]);
  const source = stream();
  const controller = new AbortController();
  const operation = readBoundedSse(source.response, {
    signal: controller.signal, onOpen() {}, onBlock() {}, createLimitError: () => new Error('limit'),
  });
  controller.abort();
  await assert.rejects(operation, { name: 'AbortError' });
  assert.equal(source.cancelled, 1);
  assert.equal(source.response.body.locked, false);
  const failed = stream();
  await assert.rejects(readBoundedSse(failed.response, {
    onOpen() { throw new Error('consumer'); }, onBlock() {}, createLimitError: () => new Error('limit'),
  }), /consumer/);
  assert.equal(failed.cancelled, 1);
  assert.equal(failed.response.body.locked, false);
});

test('trusted owner canonicalizes origin and never reads identity/epoch while unauthorized', () => {
  const manager = {
    isAuthorized: () => true,
    getCloudSyncIdentity: () => ({ streamerId: 7 }),
    getRemoteBaseUrl: () => 'https://API.example.test:443/',
    getAuthorizationEpoch: () => 9,
  };
  assert.deepEqual(getSceneOwner(manager), { scope: '["https://api.example.test","7"]', epoch: 9 });
  manager.isAuthorized = () => false;
  manager.getAuthorizationEpoch = () => assert.fail('unauthorized epoch read');
  manager.getCloudSyncIdentity = () => assert.fail('unauthorized identity read');
  assert.equal(getSceneOwner(manager), null);
});

test('trusted owner fails closed during startup and for malformed license manager state', () => {
  const valid = {
    isAuthorized: () => true, getCloudSyncIdentity: () => ({ streamerId: '7' }),
    getRemoteBaseUrl: () => 'https://api.example.test', getAuthorizationEpoch: () => 1,
  };
  for (const manager of [null, undefined, {}, { isAuthorized: true },
    { ...valid, isAuthorized: () => { throw new Error('startup'); } },
    { ...valid, getCloudSyncIdentity: () => null },
    { ...valid, getCloudSyncIdentity: () => ({ streamerId: {} }) },
    { ...valid, getCloudSyncIdentity: () => ({ streamerId: NaN }) },
    { ...valid, getRemoteBaseUrl: () => 'invalid' },
    { ...valid, getRemoteBaseUrl: () => 'https://user:secret@api.example.test' },
    { ...valid, getAuthorizationEpoch: () => undefined },
  ]) assert.equal(getSceneOwner(manager), null);
});

test('synchronous dispose fences callbacks and whenIdle drains late HTTP work before shutdown', async (t) => {
  let resolveSettings;
  const env = fixture(t, { getSettings: () => new Promise((resolve) => { resolveSettings = resolve; }) });
  env.controller.start();
  assert.equal(env.controller.dispose(), undefined);
  assert.equal(env.listeners.size, 0);
  assert.equal(env.tasks.size, 0);
  const count = env.updates.length;
  let drained = false;
  const idle = env.controller.whenIdle().then(() => { drained = true; });
  await flush();
  assert.equal(drained, false);
  resolveSettings({ overlayUrl: OVERLAY_URL });
  await idle;
  assert.equal(drained, true);
  assert.equal(env.requests.length, 0);
  assert.equal(env.updates.length, count);
  env.controller.start();
  env.controller.dispose();
  assert.equal(env.listeners.size, 0);
  assert.equal(env.updates.length, count);
});

test('dispose waits for reader cancellation and lock release', async (t) => {
  let finishCancel;
  const response = new Response(new ReadableStream({
    cancel: () => new Promise((resolve) => { finishCancel = resolve; }),
  }), { headers: { 'content-type': 'text/event-stream' } });
  const env = fixture(t, { fetchImpl: () => response });
  env.controller.start();
  await flush();
  env.controller.dispose();
  let drained = false;
  const idle = env.controller.whenIdle().then(() => { drained = true; });
  await flush();
  assert.equal(drained, false);
  assert.equal(response.body.locked, true);
  finishCancel();
  await idle;
  assert.equal(response.body.locked, false);
  assert.equal(env.tasks.size, 0);
});

test('publish DTO drives the real cloud buffer, resets on stop and never replays a prior session', async (t) => {
  const buffer = createCloudDisplayBuffer({ getOwner: () => ({ scope: '["https://api.example.test","7"]', epoch: 1 }) });
  const env = fixture(t, { onPublish: (update) => buffer.receive(update) });
  env.controller.start();
  await flush();
  assert.equal(buffer.getSnapshot().status, 'connecting');
  env.streams[0].send(state());
  await flush();
  const before = buffer.getSnapshot();
  assert.equal(before.status, 'connected');
  env.streams[0].send(gift());
  await flush();
  assert.deepEqual(buffer.getSnapshot({ epoch: before.epoch, cursor: 0 }).events, [gift()]);
  assert.equal(buffer.getSettings().style, 'signal');
  env.controller.stop();
  await env.controller.whenIdle();
  const stopped = buffer.getSnapshot({ epoch: before.epoch, cursor: 0 });
  assert.equal(stopped.status, 'offline');
  assert.equal(stopped.reset, true);
  assert.equal(stopped.state, null);
  assert.deepEqual(stopped.events, []);
});

test('account replacement during a single received chunk cannot publish remaining old events', async (t) => {
  const env = fixture(t, { onPublish(update) {
    if (update.event?.type === 'overlay-state') env.change({ streamerId: 8, epoch: 2 });
  } });
  env.controller.start();
  await flush();
  env.streams[0].bytes(Buffer.from(frame(state()) + frame(gift())));
  await flush();
  assert.deepEqual(env.events(), [state()]);
  assert.equal(env.updates.at(-1).ownerScope, '["https://api.example.test","8"]');
  assert.equal(env.updates.at(-1).status, 'connecting');
  assert.equal(env.streams[0].cancelled, 1);
  assert.equal(env.requests.length, 2);
});

test('stop cancels retry work and an old scheduled callback cannot restart a disposed controller', async (t) => {
  const env = fixture(t);
  env.controller.start();
  await flush();
  env.streams[0].close();
  await env.controller.whenIdle();
  const retry = [...env.tasks.values()][0].callback;
  env.controller.dispose();
  const count = env.updates.length;
  retry();
  await env.controller.whenIdle();
  assert.equal(env.tasks.size, 0);
  assert.equal(env.requests.length, 1);
  assert.equal(env.updates.length, count);
});

test('extracted parser preserves RemoteLicenseError code, status and retryable metadata for both device streams', async () => {
  const { createRemoteLicenseClient, RemoteLicenseError } = require('../../src/electron/license/remote-license-client');
  for (const method of ['watchCloudStateChanges', 'watchGiftEvents']) {
    const remote = createRemoteLicenseClient({ fetchImpl: async () => new Response('x'.repeat(65537), {
      status: 201, headers: { 'content-type': 'text/event-stream' },
    }) });
    await assert.rejects(remote[method]('fixture'), (error) => {
      assert.ok(error instanceof RemoteLicenseError);
      assert.equal(error.code, 'RESPONSE_TOO_LARGE');
      assert.equal(error.status, 201);
      assert.equal(error.retryable, true);
      return true;
    });
  }
});
