'use strict';

const assert = require('node:assert/strict');

const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

function response(payload) {
  return { ok: payload.ok !== false, text: async () => JSON.stringify(payload) };
}

const ROOT_DIR = path.join(__dirname, '../..');

async function createStatsHarness({ active = true } = {}) {
  function classes(initial = []) {
    const values = new Set(initial);
    return { contains: (name) => values.has(name), toggle(name, enabled) {
      if (enabled) values.add(name);
      else values.delete(name);
    } };
  }
  const section = { dataset: {}, querySelector: () => null, classList: classes() };
  const page = { classList: classes(active ? ['active'] : []) };
  const workspace = { hidden: true };
  const summary = { innerHTML: '', closest: () => section };
  const bodyListeners = new Map();
  const body = { innerHTML: '',
    addEventListener: (type, listener) => bodyListeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (bodyListeners.get(type) === listener) bodyListeners.delete(type);
    },
  };
  const requests = [];
  const documentListeners = new Map();
  const observers = [];
  const document = {
    readyState: 'loading', hidden: false,
    addEventListener: (type, fn) => documentListeners.set(type, fn),
    removeEventListener: (type) => documentListeners.delete(type),
    querySelector: () => section,
    getElementById: (id) => ({ blindBoxStatsSummary: summary, blindBoxStatsBody: body,
      giftAssistantPage: page, blindBoxAnalysisWorkspace: workspace })[id] || null,
  };
  const [{ initBlindBoxStats }, { eventBus }] = await loadModuleExports([
    path.join(ROOT_DIR, 'public/js/admin/gifts/blindbox-stats.js'), path.join(ROOT_DIR, 'public/js/shared/event-bus.js'),
  ], {
    window: {},
    document, AbortController,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.targets = new Map(); observers.push(this); }
      observe(node, options) { this.targets.set(node, options); }
      disconnect() { this.targets.clear(); }
    },
    fetch: (url, options = {}) => {
      if (!url.startsWith('/api/gifts/blind-box-stats')) {
        return Promise.resolve(response({ ok: true, data: { gifts: [] } }));
      }
      const request = Promise.withResolvers();
      requests.push({ url, signal: options.signal, ...request });
      return request.promise;
    },
  });
  const dispose = initBlindBoxStats();
  function changed(node, attribute) {
    for (const observer of observers) {
      if (observer.targets.get(node)?.attributeFilter.includes(attribute)) observer.callback();
    }
  }
  return { initBlindBoxStats, eventBus, requests, body,
    bodyListenerCount: () => bodyListeners.size,
    setActive(value) { page.classList.toggle('active', value); changed(page, 'class'); },
    setCollapsed(value) { section.classList.toggle('is-collapsed', value); changed(section, 'class'); },
    setAnalysisOpen(value) { workspace.hidden = !value; changed(workspace, 'hidden'); },
    setHidden(value) { document.hidden = value; documentListeners.get('visibilitychange')?.(); },
    close() { dispose(); },
    async finish(index, data = empty) {
      requests[index].resolve(response({ ok: true, data }));
      await new Promise(setImmediate);
    },
  };
}

const empty = {
  summary: { boxCount: 0, totalCost: 0, totalValue: 0, totalProfit: 0 },
  perUser: [],
};

function statsFor(userName) {
  return { summary: { boxCount: 2, totalCost: 48, totalValue: 49, totalProfit: 1 },
    perUser: [{ userName, viewer: `name:${userName}`, boxCount: 2, boxTypeCount: 2,
      totalCost: 48, totalValue: 49, totalProfit: 1 }] };
}

test('visible blind box summary requests the displayed ranking and coalesces in-flight updates', async () => {
  const { initBlindBoxStats, eventBus, requests, body, finish } = await createStatsHarness();

  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url, 'http://localhost').searchParams.get('top'), '10');
  await finish(0);

  eventBus.emit('state:loaded', { state: {} });
  assert.equal(requests.length, 1);
  eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  assert.equal(requests.length, 2);
  eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  assert.equal(requests.length, 2);
  await finish(1);
  assert.equal(requests.length, 3);
  await finish(2, statsFor('Test viewer'));
  assert.match(body.innerHTML, /Test viewer/);

  initBlindBoxStats();
  assert.equal(eventBus.listenerCount('gift:received'), 1);
  assert.equal(requests.length, 3);
  eventBus.emit('gift:received', { reason: 'database:clear-gifts' });
  assert.equal(requests.length, 4);
  await finish(3);
  assert.doesNotMatch(body.innerHTML, /Test viewer/);
});

test('hidden blind box summary defers invalidation and rejects reads from an earlier visible session', async () => {
  const f = await createStatsHarness({ active: false });
  const received = () => f.eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  for (let i = 0; i < 1000; i++) received();
  assert.equal(f.requests.length, 0);
  f.setActive(true);
  assert.equal(f.requests.length, 1);
  f.setActive(false);
  assert.equal(f.requests[0].signal.aborted, true);
  f.setActive(true);
  assert.equal(f.requests.length, 2);
  await f.finish(1, statsFor('Current viewer'));
  await f.finish(0, statsFor('Stale viewer'));
  assert.match(f.body.innerHTML, /Current viewer/);
  assert.doesNotMatch(f.body.innerHTML, /Stale viewer/);

  f.setHidden(true);
  for (let i = 0; i < 1000; i++) received();
  assert.equal(f.requests.length, 2);
  f.setHidden(false);
  assert.equal(f.requests.length, 3);
  await f.finish(2);
  f.setCollapsed(true);
  received();
  assert.equal(f.requests.length, 3);
  f.setCollapsed(false);
  assert.equal(f.requests.length, 4);
  await f.finish(3);
  f.setAnalysisOpen(true);
  received();
  assert.equal(f.requests.length, 4);
  f.setAnalysisOpen(false);
  assert.equal(f.requests.length, 5);
  const html = f.body.innerHTML;
  f.close();
  assert.equal(f.requests[4].signal.aborted, true);
  assert.equal(f.bodyListenerCount(), 0, 'disposal releases row click and keyboard listeners');
  received();
  f.setHidden(true);
  f.setHidden(false);
  assert.equal(f.requests.length, 5, 'closed pages release refresh triggers');
  await f.finish(4, statsFor('Closed viewer'));
  assert.equal(f.body.innerHTML, html);
  const disposeAgain = f.initBlindBoxStats();
  assert.equal(f.eventBus.listenerCount('gift:received'), 1);
  assert.equal(f.bodyListenerCount(), 2);
  assert.equal(f.requests.length, 6, 'remounting resumes a visible panel once');
  disposeAgain();
  assert.equal(f.requests[5].signal.aborted, true);
});

test('a failed blind box read waits for the next invalidation before retrying', async () => {
  const f = await createStatsHarness();
  f.requests[0].reject(new Error('offline'));
  await new Promise(setImmediate);
  assert.equal(f.requests.length, 1, 'a read failure must not start an unbounded retry loop');
  f.eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  assert.equal(f.requests.length, 2);
  await f.finish(1, statsFor('Recovered viewer'));
  assert.match(f.body.innerHTML, /Recovered viewer/);
});
