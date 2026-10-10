'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCipheriv, createDecipheriv, randomBytes, randomUUID } = require('node:crypto');
const test = require('node:test');
const { createServerRuntime } = require('../../src/server');
const { createOverlayToken } = require('../../src/server/access-policy');
const { createSceneExtraDefaults } = require('../../public/js/shared/scene-extra-components.js');
const { SCRATCH_ROOT, createScratchDirectory } = require('../helpers/scratch-directory');

function createSafeStorage() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
    },
    decryptString(value) {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

async function fixture(t) {
  const dataDir = createScratchDirectory('scene-runtime-');
  const safeStorage = createSafeStorage();
  const state = { owner: { scope: '["https://scene.test","streamer-1"]', epoch: 1 }, authorized: false };
  const externalRequests = [];
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (new URL(url).hostname !== '127.0.0.1') {
      externalRequests.push(String(url));
      throw new Error('External services are forbidden in scene runtime tests.');
    }
    return originalFetch(url, options);
  });
  let runtime;
  let app;
  t.after(async () => {
    await runtime?.stop({ exitProcess: false });
    assert.equal(path.dirname(fs.realpathSync(dataDir)), fs.realpathSync(SCRATCH_ROOT));
    fs.rmSync(dataDir, { recursive: true, force: true });
    assert.deepEqual(externalRequests, []);
  });
  async function start(startPort = 0) {
    state.authorized = false;
    runtime = createServerRuntime({ dataDir, safeStorage, getSceneOwner: () => state.owner,
      licenseGate: { isAuthorized: () => state.authorized } });
    assert.equal(typeof runtime.receiveSceneCloud, 'function');
    assert.equal(runtime.receiveSceneCloud({}), undefined);
    app = await runtime.start({ startPort });
    state.authorized = true;
  }
  await start();
  async function request(route, { body, token = runtime.getApiToken(), status = 200 } = {}) {
    const response = await fetch(app.baseUrl + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    assert.equal(result.ok, status === 200);
    return status === 200 ? result.data : result;
  }
  return {
    state, request,
    get runtime() { return runtime; },
    get baseUrl() { return app.baseUrl; },
    async restart() {
      const port = app.port;
      await runtime.stop({ exitProcess: false });
      assert.equal(runtime.receiveSceneCloud({}), undefined);
      await start(port);
    },
  };
}

function component(type) {
  return { id: randomUUID(), type, name: type, x: 0, y: 0, width: 320, height: 180,
    visible: true, locked: false, appearance: { mode: 'shared' } };
}

async function expectStreamEvent(reader, event) {
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes(`data: ${event}\n\n`)) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    text += decoder.decode(chunk.value, { stream: true });
  }
}

async function createScene(request, items) {
  const created = await request('/api/scenes/create', { body: { title: '本地场景', canvas: { width: 1920, height: 1080 } } });
  return request('/api/scenes/save', { body: { id: created.document.id, expectedRevision: created.revision,
    document: { ...created.document, items } } });
}

test('runtime HTTP saves and publishes a scene, retaining its capability and frozen version across restart', async (t) => {
  const fixtureState = await fixture(t);
  const { request } = fixtureState;
  assert.deepEqual(await request('/api/scenes/list'), []);
  await request('/api/settings', { body: { clockLabel: '首次发布' } });
  const saved = await createScene(request, ['clock', 'queue', 'overtime'].map(component));
  const id = saved.document.id;
  assert.equal(saved.revision, 2);
  assert.equal(saved.hasPublication, false);
  assert.deepEqual(await request(`/api/scenes/document?id=${id}`), saved);
  const source = await request(`/api/scenes/source?id=${id}`);
  const outputRoute = `/api/scene/output?id=${id}`;
  const readOutput = (suffix = '') => request(outputRoute + suffix, { token: source.token });
  const unpublished = await request(outputRoute, { token: source.token, status: 409 });
  assert.equal(unpublished.code, 'SCENE_NOT_PUBLISHED');
  const published = await request('/api/scenes/publish', { body: { id, expectedRevision: saved.revision } });
  assert.equal(published.publishedVersion, 1);
  assert.equal(published.revision, saved.revision);
  const firstOutput = await readOutput();
  assert.equal(firstOutput.document.items[0].appearance.config.label, '首次发布');
  assert.ok(firstOutput.document.items.every((item) => item.appearance.mode === 'independent'));
  assert.deepEqual(Object.keys(firstOutput.data).sort(), ['overtime', 'queue']);
  assert.deepEqual(firstOutput.data.queue, { queue: { current: null, waiting: [] }, superChats: [] });
  assert.equal(typeof firstOutput.data.overtime.effectiveRemainingMs, 'number');
  assert.equal(Object.hasOwn(firstOutput.data.overtime, 'background'), false);
  assert.equal((await readOutput('&version=1')).document, null);

  await request('/api/settings', { body: { clockLabel: '下一次发布' } });
  const draft = { ...saved.document, title: '未发布的修改' };
  const updated = await request('/api/scenes/save', { body: { id, expectedRevision: saved.revision, document: draft } });
  assert.equal(updated.revision, 3);
  const conflict = await request('/api/scenes/save', { body: { id, expectedRevision: saved.revision, document: draft }, status: 409 });
  assert.equal(conflict.code, 'SCENE_CONFLICT');
  assert.deepEqual((await readOutput()).document, firstOutput.document);
  const oldBaseUrl = fixtureState.baseUrl;
  const oldAdminToken = fixtureState.runtime.getApiToken();
  await fixtureState.restart();
  assert.equal(fixtureState.baseUrl, oldBaseUrl);
  assert.notEqual(fixtureState.runtime.getApiToken(), oldAdminToken);
  await request('/api/scenes/list', { token: oldAdminToken, status: 401 });
  assert.deepEqual(await request(`/api/scenes/source?id=${id}`), { ...source, itemIds: firstOutput.document.items.map((item) => item.id) });
  assert.deepEqual(await request(`/api/scenes/document?id=${id}`), updated);
  assert.deepEqual((await readOutput()).document, firstOutput.document);
  assert.deepEqual((await request('/api/scenes/list')).map((scene) => scene.document.id), [id]);
  await request('/api/scenes/publish', { body: { id, expectedRevision: updated.revision } });
  const nextOutput = await readOutput('&version=1');
  assert.equal(nextOutput.version, 2);
  assert.equal(nextOutput.document.title, draft.title);
  assert.equal(nextOutput.document.items[0].appearance.config.label, '下一次发布');
});

for (const type of ['gift-feed', 'gift-wishes']) {
  test(`runtime ${type} output reads the actual gift projection and recovers from an unavailable source`, async (t) => {
    const { runtime, request } = await fixture(t);
    const source = runtime.resolveGiftSource('a'.repeat(64));
    const activeSource = { sourceId: source.id, syncState: 'LIVE', partial: false };
    runtime.setActiveGiftSource(activeSource);
    const saved = await createScene(request, [{ ...component(type),
      appearance: { mode: 'independent', config: createSceneExtraDefaults(type) } }]);
    const id = saved.document.id;
    await request('/api/scenes/publish', { body: { id, expectedRevision: saved.revision } });
    const capability = await request(`/api/scenes/source?id=${id}`);
    const output = () => request(`/api/scene/output?id=${id}`, { token: capability.token });
    const first = await output();
    assert.deepEqual(first.data[type].items, []);
    assert.equal(first.data[type].viewRevision, runtime.getGiftViewRevision());
    assert.equal(first.document.items[0].type, type);
    for (const unavailable of [null, { ...activeSource, syncState: 'SOURCE_SWITCHING' }]) {
      runtime.setActiveGiftSource(unavailable);
      assert.equal((await output()).data[type], null);
    }
    runtime.setActiveGiftSource(activeSource);
    const recovered = await output();
    assert.deepEqual(recovered.data[type].items, []);
    assert.equal(recovered.data[type].viewRevision, runtime.getGiftViewRevision());
    assert.notEqual(recovered.data[type].viewRevision, first.data[type].viewRevision);
  });
}

test('runtime gift preview broadcasts reach only their independent scene projections', async (t) => {
  const { request, state } = await fixture(t);
  const items = ['gift-frame', 'guard-thanks'].map(type => ({ ...component(type),
    appearance: { mode: 'independent', config: type === 'guard-thanks' ? { textMode: 'zh' } : {} } }));
  const saved = await createScene(request, items);
  const id = saved.document.id;
  await request('/api/scenes/publish', { body: { id, expectedRevision: saved.revision } });
  const source = await request(`/api/scenes/source?id=${id}`);
  const output = () => request(`/api/scene/output?id=${id}`, { token: source.token });
  const before = await output();
  assert.deepEqual(before.data['gift-frame'].events, []);
  await request('/api/gifts/frame/preview', { body: { userName: '边框', giftName: '林间花信', num: 2 } });
  await request('/api/gifts/guard-thanks/preview', { body: { tier: 'captain', userName: '上舰', months: 1 } });
  const after = await output();
  assert.deepEqual(after.data['gift-frame'].events.map(event => event.payload.type), ['gift:frame']);
  assert.deepEqual(after.data['guard-thanks'].events.map(event => event.payload.type), ['gift:guard-thanks']);
  assert.equal(after.data['gift-frame'].sequence, 2);
  state.owner = { ...state.owner, epoch: 2 };
  const renewed = await output();
  assert.notEqual(renewed.data['gift-frame'].epoch, after.data['gift-frame'].epoch);
  assert.deepEqual(renewed.data['gift-frame'].events, []);
  assert.deepEqual(renewed.data['guard-thanks'].events, []);
});

test('runtime cloud ingress projects current-owner events and fences owner changes and revoked sources', async (t) => {
  const { runtime, request, state } = await fixture(t);
  const owner = state.owner;
  const update = (status, event) => runtime.receiveSceneCloud({ ownerScope: owner.scope,
    authorizationEpoch: owner.epoch, connectionEpoch: 'connection-1', status, ...(event ? { event } : {}) });
  assert.equal(update('connecting'), true);
  assert.equal(update('connected', { type: 'overlay-state', style: 'signal', state: 'running', liveStatus: 1,
    liveSessionId: 'session-1', confirmationMessage: '开播' }), true);
  const saved = await createScene(request, [component('danmaku')]);
  const id = saved.document.id;
  await request('/api/scenes/publish', { body: { id, expectedRevision: saved.revision } });
  const source = await request(`/api/scenes/source?id=${id}`);
  const outputRoute = `/api/scene/output?id=${id}`;
  const initial = await request(outputRoute, { token: source.token });
  assert.equal(initial.document.items[0].appearance.config.style, 'signal');
  assert.equal(initial.data.danmaku.status, 'connected');
  assert.deepEqual(initial.data.danmaku.events, []);
  const event = { type: 'danmaku', liveSessionId: 'session-1', name: '观众', message: '真实事件',
    timestamp: '2026-09-30T08:00:00.000Z', emotes: [] };
  assert.equal(update('connected', { ...event, deviceToken: 'private-test-value' }), true);
  const cursorRoute = outputRoute + `&version=1&epoch=${initial.data.danmaku.epoch}&cursor=0`;
  const displayed = await request(cursorRoute, { token: source.token });
  assert.equal(displayed.document, null);
  assert.deepEqual(displayed.data.danmaku.events, [event]);
  assert.equal(displayed.data.danmaku.nextCursor, 1);

  state.owner = { scope: '["https://scene.test","streamer-2"]', epoch: 2 };
  assert.equal(update('connected', event), false);
  assert.deepEqual(await request('/api/scenes/list'), []);
  await request(`/api/scenes/document?id=${id}`, { status: 404 });
  await request(outputRoute, { token: source.token, status: 404 });
  state.owner = { ...owner, epoch: 3 };
  const renewed = await request(cursorRoute, { token: source.token });
  assert.equal(renewed.data.danmaku.status, 'offline');
  assert.equal(renewed.data.danmaku.reset, true);
  assert.deepEqual(renewed.data.danmaku.events, []);
  const rotated = await request('/api/scenes/rotate', { body: { id } });
  assert.notEqual(rotated.token, source.token);
  await request(outputRoute, { token: source.token, status: 403 });
  assert.equal((await request(outputRoute, { token: rotated.token })).version, 1);
  state.owner = null;
  const loggedOut = await request(outputRoute, { token: rotated.token, status: 403 });
  assert.equal(loggedOut.code, 'SCENE_OWNER_REQUIRED');
});

test('standalone danmaku reads the shared cloud projection without a scene and keeps page capability isolation', async (t) => {
  const { runtime, request, state } = await fixture(t);
  const token = createOverlayToken(runtime.getApiToken(), 'danmaku');
  const other = createOverlayToken(runtime.getApiToken(), 'clock');
  const owner = { ...state.owner };
  const update = (status, event) => runtime.receiveSceneCloud({ ownerScope: owner.scope,
    authorizationEpoch: owner.epoch, connectionEpoch: 'standalone', status, ...(event ? { event } : {}) });
  const initial = await request('/api/danmaku/display', { token });
  assert.equal(initial.config, null);
  assert.equal(initial.data.status, 'offline');
  update('connecting');
  update('connected', { type: 'overlay-state', style: 'bubble', state: 'running', liveStatus: 1,
    liveSessionId: 'live-standalone', confirmationMessage: '开播', privateToken: 'private-sentinel' });
  const ready = await request('/api/danmaku/display', { token });
  assert.equal(ready.config.style, 'bubble');
  update('connected', { type: 'danmaku', liveSessionId: 'live-standalone', name: '观众', message: '独立组件', privateToken: 'private-sentinel' });
  const route = `/api/danmaku/display?epoch=${ready.data.epoch}&cursor=${ready.data.nextCursor}`;
  const live = await request(route, { token });
  assert.equal(live.data.events[0].message, '独立组件');
  assert.equal(JSON.stringify(live).includes('private-sentinel'), false);
  assert.deepEqual(await request('/api/scenes/list'), []);
  await request(route, { token: other, status: 403 });
  await request(route, { token: '', status: 401 });
  await request('/api/scenes/list', { token, status: 403 });
  await request('/api/danmaku/display', { body: {}, token, status: 403 });
  assert.equal((await request(`/api/danmaku/display?epoch=${ready.data.epoch}&cursor=invalid`, { token })).data.reset, true);
  state.owner = { scope: 'new-owner', epoch: 2 };
  const switched = await request(route, { token });
  assert.equal(switched.config, null);
  assert.equal(switched.data.status, 'offline');
  assert.deepEqual(switched.data.events, []);
  assert.equal(update('connected', { type: 'danmaku', liveSessionId: 'live-standalone', message: 'stale' }), false);
});

test('standalone notification route enforces its scope and header credential and revokes on account changes', { timeout: 10000 }, async t => {
  const { runtime, request, state, baseUrl } = await fixture(t);
  const token = createOverlayToken(runtime.getApiToken(), 'danmaku');
  await request('/api/danmaku/events', { token: '', status: 401 });
  await request('/api/danmaku/events', { token: createOverlayToken(runtime.getApiToken(), 'clock'), status: 403 });
  await request('/api/danmaku/events', { body: {}, token, status: 403 });
  const queryOnly = await fetch(`${baseUrl}/api/danmaku/events?token=${token}`);
  assert.equal(queryOnly.status, 401);
  await queryOnly.json();
  const abort = new AbortController();
  const response = await fetch(`${baseUrl}/api/danmaku/events`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  const reader = response.body.getReader();
  try {
    await expectStreamEvent(reader, 'ready');
    runtime.receiveSceneCloud({ ownerScope: state.owner.scope, authorizationEpoch: state.owner.epoch,
      connectionEpoch: 'standalone-events', status: 'connecting' });
    await expectStreamEvent(reader, 'change');
    state.owner = { scope: 'different-owner', epoch: 2 };
    await expectStreamEvent(reader, 'revoked');
    assert.equal((await reader.read()).done, true);
  } finally {
    abort.abort();
    await reader.cancel().catch(() => {});
  }
});

test('runtime scene streams notify game updates, drawing operations and round patches without ordinary WebSocket clients', { timeout: 10000 }, async t => {
  const { request, baseUrl } = await fixture(t);
  const saved = await createScene(request, [{ ...component('games'), appearance: { mode: 'independent',
    config: { ...createSceneExtraDefaults('games'), game: 'draw-guess' } } }]);
  const id = saved.document.id;
  await request('/api/scenes/publish', { body: { id, expectedRevision: saved.revision } });
  const source = await request(`/api/scenes/source?id=${id}`);
  const abort = new AbortController();
  const events = await fetch(`${baseUrl}/api/scene/events?id=${id}`, {
    headers: { Authorization: `Bearer ${source.token}` },
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
  });
  assert.equal(events.status, 200);
  const reader = events.body.getReader();
  const expectEvent = event => expectStreamEvent(reader, event);
  const session = async () => (await request(`/api/scene/output?id=${id}`, { token: source.token })).data.games.session;
  try {
    await expectEvent('ready');
    const started = await request('/api/games/session', { body: { game: 'draw-guess', totalRounds: 2 } });
    await expectEvent('change');
    assert.equal((await session()).state.phase, 'drawing');
    await request('/api/games/session/draw', { body: { action: 'append', clientId: 'scene-test', strokeId: 'stroke-1',
      sessionId: started.sessionId, round: 1, color: '#222034', width: 4, points: [{ x: 0.1, y: 0.1 }] } });
    await expectEvent('change');
    assert.equal((await session()).state.canvas.strokes[0].id, 'stroke-1');
    await request('/api/games/session/move', { body: { value: { action: 'finish-round' } } });
    await expectEvent('change');
    assert.equal((await session()).state.phase, 'round-result');
  } finally {
    abort.abort();
    await reader.cancel().catch(() => {});
  }
});
