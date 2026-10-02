'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { getClockConfig } = require('../../src/server/clock-contract');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-store');
const { startCanvasOutputFixture } = require('../helpers/canvas-output-fixture');
const entry = file => path.resolve(__dirname, '../../public/js', file);
const load = (file, globals = {}) => loadModuleExports(entry(file), { TextEncoder, queueMicrotask, structuredClone, ...globals });
const plain = value => JSON.parse(JSON.stringify(value));
const clockConfig = getClockConfig(DEFAULT_SETTINGS);
function item(type = 'clock', mode = 'independent', config = clockConfig) {
  return { id: randomUUID(), type, name: type, x: 0, y: 0, width: 320, height: 180, visible: true, locked: false,
    appearance: mode === 'shared' ? { mode } : { mode, config } };
}
const documentOf = (items = [item()]) => ({ schemaVersion: 1, id: randomUUID(), title: 'Audit', canvas: { width: 1920, height: 1080 }, items });

async function rendererFixture() {
  const messages = new Map();
  const listeners = new Map();
  const timers = new Map();
  let serial = 0;
  function node(tag) {
    const result = { tag, style: {}, children: [], classList: { remove() {} }, setAttribute() {},
      append(child) { child.parent = result; result.children.push(child); },
      remove() { if (result.parent) result.parent.children = result.parent.children.filter(child => child !== result); } };
    if (tag === 'iframe') {
      const sent = [];
      result.contentWindow = { postMessage(message) { sent.push(plain(message)); } };
      messages.set(result, sent);
    }
    return result;
  }
  const window = { document: { createElement: node }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const { createSceneRenderer } = await load('overlays/scene-renderer.js', { window,
    setTimeout(fn) { timers.set(++serial, fn); return serial; }, clearTimeout(id) { timers.delete(id); } });
  const host = node('host');
  const renderer = createSceneRenderer(host);
  function complete(frame) {
    for (const type of ['ready', 'prepared']) signal(frame, type);
  }
  function signal(frame, type) {
    listeners.get('message')({ origin: 'null', source: frame.contentWindow, data: { type: `component-preview:${type}` } });
  }
  function fail(frame) {
    listeners.get('message')({ origin: 'null', source: frame.contentWindow, data: { type: 'component-preview:status', message: 'Synthetic renderer failure' } });
  }
  return { renderer, host, complete, signal, fail, messages };
}
const connected = events => ({ status: 'connected', epoch: 'one', nextCursor: 2, reset: false, gap: false,
  state: { liveStatus: 1, liveSessionId: 'live', confirmationMessage: 'Live' }, events });
const sceneData = events => ({ danmaku: connected(events) });
const outputDoc = () => documentOf([item('danmaku', 'independent', { style: 'signal' })]);

test('renderer rejects non-string and unknown types without replacing its active version', async t => {
  const f = await rendererFixture(); t.after(() => f.renderer.dispose());
  f.renderer.update({ version: 1, document: outputDoc(), data: sceneData([]) });
  f.complete(f.host.children[0].children[0]);
  const active = f.host.children[0];
  for (const type of [['clock'], 'constructor', '__proto__', 'canvas', 'unknown']) {
    f.renderer.update({ version: 2, document: documentOf([item(type)]), data: {} });
    assert.equal(f.renderer.getVersion(), 1);
    assert.equal(f.host.children.length, 1);
    assert.equal(f.host.children[0], active);
  }
});

test('A04: staged version commits offline data after disconnect', async t => {
  const f = await rendererFixture(); t.after(() => f.renderer.dispose());
  f.renderer.update({ version: 1, document: outputDoc(), data: sceneData([]) });
  f.complete(f.host.children[0].children[0]);
  f.renderer.update({ version: 2, document: outputDoc(), data: sceneData([{ type: 'danmaku', message: 'stale', liveSessionId: 'live' }]) });
  const stagingFrame = f.host.children[1].children[0];
  f.renderer.disconnect();
  f.complete(stagingFrame);
  const last = f.messages.get(stagingFrame).filter(message => message.type === 'component-preview:data').at(-1);
  assert.equal(f.renderer.getVersion(), 2);
  assert.equal(last.data.status, 'offline');
  assert.deepEqual(last.data.events, []);
});

test('A05: retains events across empty polls while the first renderer prepares', async t => {
  const f = await rendererFixture(); t.after(() => f.renderer.dispose());
  f.renderer.update({ version: 1, document: outputDoc(), data: sceneData([]) });
  const frame = f.host.children[0].children[0];
  f.renderer.update({ version: 1, document: null, data: sceneData([{ type: 'danmaku', message: 'lost', liveSessionId: 'live' }]) });
  f.renderer.update({ version: 1, document: null, data: sceneData([]) });
  f.complete(frame);
  assert.equal(f.messages.get(frame).some(message => message.data?.events?.some(event => event.message === 'lost')), true);
});

test('A09: retained old queue continues receiving data when a failing new publication removes that type', async t => {
  const fixture = await startCanvasOutputFixture(); t.after(() => fixture.close());
  const f = await rendererFixture(); t.after(() => f.renderer.dispose());
  const created = fixture.service.create({ title: 'Audit version projection', canvas: { width: 1920, height: 1080 } });
  const initial = { ...created.document, items: [item('queue', 'independent', fixture.configs.queue)] };
  const saved = fixture.service.save({ id: initial.id, expectedRevision: created.revision, document: initial });
  fixture.service.publish({ id: initial.id, expectedRevision: saved.revision });
  const { token } = fixture.service.getSource(initial.id);
  const read = () => fixture.service.getOutput({ id: initial.id, token, version: f.renderer.getVersion(), projection: f.renderer.getProjection() });
  f.renderer.update(read());
  const oldFrame = f.host.children[0].children[0];
  f.complete(oldFrame);
  const lastQueueMessage = () => f.messages.get(oldFrame).filter(message => message.type === 'component-preview:data').at(-1);
  assert.equal(lastQueueMessage().data.queue.waiting[0].song_name, '合成实时歌曲');
  const current = fixture.service.get(initial.id);
  const next = { ...current.document, items: [item('clock', 'independent', fixture.configs.clock)] };
  const savedNext = fixture.service.save({ id: next.id, expectedRevision: current.revision, document: next });
  fixture.service.publish({ id: next.id, expectedRevision: savedNext.revision });
  f.renderer.update(read());
  f.fail(f.host.children[1].children[0]);
  assert.equal(f.renderer.getVersion(), 1);
  fixture.runtime.queue.waiting[0].song_name = 'Updated after staging failure';
  const output = read();
  assert.equal(output.version, 2);
  assert.equal(Object.hasOwn(output.data, 'queue'), true);
  f.renderer.update(output);
  assert.equal(lastQueueMessage().data.queue.waiting[0].song_name, 'Updated after staging failure');
  f.complete(f.host.children[1].children[0]);
  assert.equal(f.renderer.getVersion(), 2);
  assert.equal(Object.hasOwn(read().data, 'queue'), false);
});

test('disconnect before ready, between ready/prepared and after commit never replays the prior epoch', async t => {
  for (const stage of ['before-ready', 'before-prepared', 'committed']) {
    const f = await rendererFixture(); t.after(() => f.renderer.dispose());
    f.renderer.update({ version: 1, document: outputDoc(), data: sceneData([{ message: 'stale' }]) });
    const frame = f.host.children[0].children[0];
    if (stage !== 'before-ready') f.signal(frame, 'ready');
    if (stage === 'committed') f.signal(frame, 'prepared');
    f.renderer.disconnect();
    if (stage === 'before-ready') f.signal(frame, 'ready');
    if (stage !== 'committed') f.signal(frame, 'prepared');
    const data = () => f.messages.get(frame).filter(message => message.type === 'component-preview:data').at(-1);
    assert.equal(data().data.status, 'offline');
    assert.deepEqual(data().data.events, []);
    f.renderer.update({ data: { danmaku: { ...connected([{ message: 'new' }]), epoch: 'two', reset: true } } });
    assert.equal(data().data.epoch, 'two');
    assert.deepEqual(data().data.events.map(event => event.message), ['new']);
  }
});

test('pending events keep order once, cap at 200 with gap, and reset on epoch/session/reset', async t => {
  for (const boundary of ['none', 'overflow', 'epoch', 'session', 'reset']) {
    const f = await rendererFixture(); t.after(() => f.renderer.dispose());
    f.renderer.update({ version: 1, document: outputDoc(), data: sceneData([]) });
    const frame = f.host.children[0].children[0];
    const count = boundary === 'overflow' ? 205 : 3;
    for (let index = 0; index < count; index++) {
      f.renderer.update({ data: sceneData([{ message: String(index) }]) });
      f.renderer.update({ data: sceneData([]) });
    }
    if (['epoch', 'session', 'reset'].includes(boundary)) {
      const cloud = connected([{ message: 'fresh' }]);
      if (boundary === 'epoch') cloud.epoch = 'two';
      if (boundary === 'session') cloud.state.liveSessionId = 'next-live';
      if (boundary === 'reset') cloud.reset = true;
      f.renderer.update({ data: { danmaku: cloud } });
    }
    f.complete(frame);
    const delivered = f.messages.get(frame).filter(message => message.type === 'component-preview:data');
    assert.equal(delivered.length, 1);
    assert.deepEqual(delivered[0].data.events.map(event => event.message), boundary === 'none' ? ['0', '1', '2']
      : boundary === 'overflow' ? Array.from({ length: 200 }, (_, index) => String(index + 5)) : ['fresh']);
    assert.equal(delivered[0].data.gap, boundary === 'overflow');
  }
});

test('switch failures do not replay consumed events and revocation removes data, projection and pending callbacks', async t => {
  const f = await rendererFixture(); t.after(() => f.renderer.dispose());
  f.renderer.update({ version: 1, projection: 'first', document: outputDoc(), data: sceneData([]) });
  const old = f.host.children[0].children[0];
  f.complete(old);
  f.renderer.update({ version: 2, projection: 'next', document: outputDoc(), data: sceneData([{ message: 'only-once' }]) });
  const failed = f.host.children[1].children[0];
  f.fail(failed);
  f.complete(failed);
  assert.equal(f.renderer.getProjection(), 'first');
  f.renderer.update({ version: 2, projection: 'next', document: outputDoc(), data: sceneData([]) });
  const next = f.host.children[1].children[0];
  f.complete(next);
  assert.equal(f.messages.get(old).flatMap(message => message.data?.events || []).length, 1);
  assert.equal(f.messages.get(next).flatMap(message => message.data?.events || []).length, 0);
  assert.equal(f.renderer.getProjection(), 'next');
  f.renderer.revoke();
  f.complete(next);
  assert.equal(f.renderer.getVersion(), 0);
  assert.equal(f.renderer.getProjection(), '');
  assert.equal(f.host.children.length, 0);
});

test('removed overtime and danmaku projections continue for an active receipt then stop at commit', async t => {
  const fixture = await startCanvasOutputFixture(); t.after(() => fixture.close());
  const f = await rendererFixture(); t.after(() => f.renderer.dispose());
  const created = fixture.service.create({ title: 'projection continuity', canvas: { width: 1920, height: 1080 } });
  let saved = fixture.service.save({ id: created.document.id, expectedRevision: 1,
    document: { ...created.document, items: ['overtime', 'danmaku'].map(type => item(type, 'independent', fixture.configs[type])) } });
  fixture.service.publish({ id: created.document.id, expectedRevision: saved.revision });
  const { id, token } = fixture.service.getSource(created.document.id);
  let epoch = '', cursor = 0;
  const read = () => {
    const output = fixture.service.getOutput({ id, token, version: f.renderer.getVersion(), projection: f.renderer.getProjection(), epoch, cursor });
    if (output.data.danmaku) { epoch = output.data.danmaku.epoch; cursor = output.data.danmaku.nextCursor; }
    return output;
  };
  f.renderer.update(read());
  const [overtime, danmaku] = f.host.children[0].children;
  f.complete(overtime); f.complete(danmaku);
  saved = fixture.service.save({ id, expectedRevision: saved.revision,
    document: { ...saved.document, items: [item('clock', 'independent', fixture.configs.clock)] } });
  fixture.service.publish({ id, expectedRevision: saved.revision });
  f.renderer.update(read());
  f.fail(f.host.children[1].children[0]);
  fixture.runtime.overtime.revision++;
  fixture.runtime.overtime.effectiveRemainingMs = 300000;
  fixture.updateCloud({ type: 'danmaku', message: 'after failure', name: 'viewer', liveSessionId: 'synthetic-live' });
  f.renderer.update(read());
  assert.equal(f.messages.get(overtime).filter(message => message.type === 'component-preview:data').at(-1).data.effectiveRemainingMs, 300000);
  assert.equal(f.messages.get(danmaku).flatMap(message => message.data?.events || []).at(-1).message, 'after failure');
  f.complete(f.host.children[1].children[0]);
  assert.equal(f.renderer.getVersion(), 2);
  assert.deepEqual(Object.keys(read().data), []);
});
