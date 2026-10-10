'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { createSceneRuntime } = require('../../src/server/scene-runtime');
const { migrateScenes, migrateComponentOutputSizes, migrateCanvasPresets, migrateSceneDeletion } = require('../../src/storage/scene-migration');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-store');
const { createSceneExtraDefaults } = require('../../public/js/shared/scene-extra-components.js');

function fixture(t, getContext) {
  const db = new DatabaseSync(':memory:');
  migrateScenes(db);
  migrateComponentOutputSizes(db); migrateCanvasPresets(db); migrateSceneDeletion(db);
  const state = { owner: { scope: 'synthetic-owner', epoch: 1 } };
  const runtime = createSceneRuntime({ songDb: db, getContext,
    getState: () => ({ settings: DEFAULT_SETTINGS }),
    runtimeOptions: { getSceneOwner: () => state.owner,
      sceneSecretCodec: { isAvailable: () => true,
        encrypt: value => Buffer.from(value).toString('base64'),
        decrypt: value => Buffer.from(value, 'base64').toString() } } });
  t.after(() => { runtime.dispose(); db.close(); });
  return { runtime, state };
}

function publish(runtime, type) {
  const { service } = runtime;
  const created = service.create({ title: '场景通知', canvas: { width: 1920, height: 1080 } });
  const item = { id: randomUUID(), type, name: type, x: 0, y: 0, width: 320, height: 180, visible: true, locked: false,
    appearance: type === 'clock' ? { mode: 'shared' } : { mode: 'independent', config: createSceneExtraDefaults(type) } };
  const saved = service.save({ id: created.document.id, expectedRevision: created.revision,
    document: { ...created.document, items: [item] } });
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

test('cloud demand follows display reads, leaves other scenes idle and expires after the last read', t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const { runtime } = fixture(t);
  const changes = [];
  runtime.subscribeCloudDemand(active => changes.push(active));
  const clock = publish(runtime, 'clock');
  runtime.service.getOutput(clock);
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
  t.mock.method(runtime.events, 'notify', change => changes.push(change));
  const update = { ownerScope: state.owner.scope, authorizationEpoch: 1, connectionEpoch: 'connection-1', status: 'connecting' };
  assert.equal(runtime.receiveCloud({ ...update, authorizationEpoch: 0 }), false);
  assert.deepEqual(changes, []);
  assert.equal(runtime.receiveCloud(update), true);
  assert.equal(runtime.receiveCloud({ ...update, status: 'connected', event: { type: 'overlay-state', style: 'bubble',
    state: 'running', liveStatus: 1, liveSessionId: 'live-1', confirmationMessage: '开播' } }), true);
  assert.deepEqual(changes.splice(0), [{ types: ['danmaku'] }, { types: ['danmaku'] }]);
  const display = runtime.readDanmakuDisplay({});
  assert.equal(display.config.style, 'bubble');
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
  const { runtime } = fixture(t, () => context);
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
