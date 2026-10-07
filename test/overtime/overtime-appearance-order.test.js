'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');

const entry = (name) => path.join(__dirname, '../../public/js/admin', name);
const plain = (value) => JSON.parse(JSON.stringify(value));
const snapshot = (revision, backgroundPath, effectiveRemainingMs = 60000) => ({
  revision, enabled: true, status: 'paused', effectiveRemainingMs,
  background: { path: backgroundPath, fit: 'cover' }, rules: [],
});

async function fixture() {
  const nodes = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', addEventListener() {}, classList: { toggle() {} } });
    return nodes.get(id);
  };
  const requests = [];
  const document = { getElementById: byId, visibilityState: 'hidden' };
  const { createOvertimeStatusView } = await loadModuleExports(entry('overtime-status-view.js'), {
    document, performance: { now: () => 0 },
  });
  const status = createOvertimeStatusView({ byId, formatClockDisplay: (ms) => String(ms), renderInitialDuration() {},
    getGiftDetection: () => ({}), getRuleEditor: () => null, isRulesDirty: () => false, onLimits() {} });
  const { createOvertimeAppearance } = await loadModuleExports(entry('overtime-preview.js'), {
    document,
    fetch(url, options) {
      const request = Promise.withResolvers();
      requests.push({ url, options, ...request });
      return request.promise;
    },
  });
  const renderState = (next, options) => {
    if (status.renderState(next, options) === false) return;
    appearance.receive(status.getState(), options);
  };
  const appearance = createOvertimeAppearance({ initial: snapshot(1, 'A'), onSavedState: renderState });
  renderState(snapshot(1, 'A'));
  const respond = (index, data) => requests[index].resolve({ ok: true, status: 200,
    text: async () => JSON.stringify({ ok: true, data }) });
  return { appearance, status, requests, renderState, respond, byId };
}

for (const echo of [false, true]) {
  test(`overtime rejects a stale background ACK without rolling back time or discarding the draft (echo=${echo})`, async () => {
    const f = await fixture();
    const { controller } = f.appearance;
    controller.edit({ path: 'B' });
    const saving = controller.save();
    if (echo) f.renderState(snapshot(2, 'B'));
    f.renderState(snapshot(3, 'C', 90000));
    f.respond(0, snapshot(2, 'B', 60000));
    assert.equal(await saving, false);
    assert.equal(f.status.getState().revision, 3);
    assert.equal(f.byId('overtimeClockValue').textContent, '90000');
    assert.deepEqual(plain(controller.getState().saved), { path: 'C', fit: 'cover' });
    assert.deepEqual(plain(controller.getState().draft), { path: echo ? 'C' : 'B', fit: 'cover' });
    assert.equal(controller.getState().dirty, !echo);
    assert.match(controller.getState().error, /其他入口更新/);
    controller.edit({ path: 'B' });
    const retry = controller.save();
    f.respond(1, snapshot(4, 'B', 90000));
    assert.equal(await retry, true);
    assert.equal(controller.getState().dirty, false);
    assert.equal(f.status.getState().revision, 4);
  });
}

test('a newer time-only update does not reject a background save or accept its stale countdown', async () => {
  const f = await fixture();
  const { controller } = f.appearance;
  controller.edit({ path: 'B' });
  const saving = controller.save();
  f.renderState(snapshot(3, 'B', 90000));
  controller.edit({ path: 'D' });
  f.respond(0, snapshot(2, 'B', 60000));
  assert.equal(await saving, true);
  assert.equal(controller.getState().saved.path, 'B');
  assert.equal(controller.getState().draft.path, 'D');
  assert.equal(f.status.getState().revision, 3);
  assert.equal(f.byId('overtimeClockValue').textContent, '90000');
  assert.equal(f.requests.length, 1);
});

test('overtime status refuses older state from any response but permits current revisions', async () => {
  const f = await fixture();
  f.renderState(snapshot(3, 'C', 90000));
  f.renderState(snapshot(2, 'B', 60000));
  assert.equal(f.status.getState().revision, 3);
  assert.equal(f.appearance.controller.getState().saved.path, 'C');
  f.renderState(snapshot(3, 'C', 80000));
  assert.equal(f.byId('overtimeClockValue').textContent, '80000');
});

test('a state-owner accepted restart replaces the clock and background and invalidates the prior save', async () => {
  const f = await fixture();
  const { controller } = f.appearance;
  const window = { dispatchEvent() {} };
  const { stateService } = await loadModuleExports(entry('state.js'), {
    window, document: { getElementById: () => ({ hidden: false }) },
    location: { protocol: 'http:', host: 'localhost' },
    WebSocket: class {
      constructor() { this.listeners = new Map(); }
      addEventListener(type, listener) { this.listeners.set(type, listener); }
    },
  });
  window.AdminApp.eventBus.on('state:loaded', ({ state, isConnectionSnapshot }) => {
    f.renderState(state.overtime, { allowRevisionReset: isConnectionSnapshot });
  });
  stateService.connectSocket();
  const receive = (state, reason) => stateService.ws.listeners.get('message')({
    data: JSON.stringify({ type: 'snapshot', state: { overtime: state }, reason }),
  });
  receive(snapshot(10, 'A', 120000));
  controller.edit({ path: 'B' });
  const saving = controller.save();
  receive(snapshot(1, 'C', 30000), 'connect');
  assert.equal(f.status.getState().revision, 1);
  assert.equal(f.byId('overtimeClockValue').textContent, '30000');
  assert.equal(controller.getState().saved.path, 'C');
  assert.equal(controller.getState().draft.path, 'B');
  f.respond(0, snapshot(11, 'B', 120000));
  assert.equal(await saving, false);
  assert.equal(f.status.getState().revision, 1);
  assert.equal(f.byId('overtimeClockValue').textContent, '30000');
  assert.equal(controller.getState().saved.path, 'C');
  assert.equal(controller.getState().draft.path, 'B');
  const retry = controller.save();
  f.respond(1, snapshot(2, 'B', 30000));
  assert.equal(await retry, true);
});
