'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createFixture, deferred, flush } = require('../helpers/overtime-gift-picker-fixture');
const { createFixture: createServiceFixture, fixedRule } = require('../helpers/overtime-service-fixture');

const ROOT_DIR = path.join(__dirname, '../..');

test('a failed overview leaves the last successfully read settlement list visible', async () => {
  const reads = [];
  const { namespace: { eventBus, Events }, state } = await createFixture({
    readOverview() {
      const read = deferred();
      reads.push(read);
      return read.promise;
    },
  });
  const update = revision => eventBus.emit(Events.OVERTIME_UPDATED, { state: { revision }, adjustment: {} });
  const success = (...settlements) => ({ payload: { ok: true, data: { settlements } } });
  update(1);
  reads[0].resolve(success('甲'));
  await flush();
  assert.equal(reads.length, 2);
  reads[1].resolve({ payload: { ok: false, error: 'offline' } });
  await flush();
  assert.deepEqual(state.settlements, ['甲']);

  update(2);
  reads[2].resolve(success('丙', '乙', '甲'));
  await flush();
  assert.deepEqual(state.settlements, ['丙', '乙', '甲']);
});

test('unrelated snapshots keep the running clock anchored until an overtime update or connection baseline', async () => {
  const { clock, document, namespace: { eventBus, Events }, state } = await createFixture();
  const overtime = { revision: 8, status: 'running', effectiveRemainingMs: 10000, rules: [] };
  const emit = (fields, options) => eventBus.emit(Events.STATE_LOADED, { state: { overtime, ...fields }, ...options });
  const value = () => document.getElementById('overtimeClockValue').textContent;
  emit({});
  const before = state.ruleRenders;
  const clears = state.timerClears;
  for (let i = 0; i < 20; i++) {
    clock.tick(250);
    emit({ queue: [i], superChats: [i] }, { changedKeys: ['queue', 'superChats'] });
  }
  emit({ giftDetection: { consumers: { giftStatistics: true } } }, { changedKeys: ['giftDetection'] });
  assert.deepEqual([value(), state.ruleRenders - before, state.timerClears - clears], ['00:00:05', 0, 0]);
  assert.equal(document.getElementById('overtimeGiftStatsStatus').classList.contains('good'), true);
  emit({ overtime: { ...overtime, revision: 1, effectiveRemainingMs: 3000 } },
    { changedKeys: [], isConnectionSnapshot: true });
  assert.equal(value(), '00:00:03');
  state.setPanelVisible(false);
  clock.tick(2000);
  assert.equal(value(), '00:00:03', 'a hidden panel does not tick');
  state.setPanelVisible(true);
  assert.equal(value(), '00:00:01', 'return uses the existing monotonic anchor');
});

test('cancelling reset or applying a new duration leaves the overtime countdown untouched', async () => {
  const fixture = await createFixture({
    initialState: { overtime: { initialSeconds: 3600, effectiveRemainingMs: 9000000, status: 'running' } },
    parsedDuration: 7200,
    confirmImpl: async () => false,
  });
  await fixture.document.getElementById('overtimeResetBtn').dispatchEvent('click');
  await fixture.document.getElementById('overtimeApplyTimeBtn').dispatchEvent('click');
  assert.equal(fixture.state.apiCalls.length, 0);
  assert.equal(fixture.state.confirmationCalls.length, 2);
  assert.match(fixture.state.confirmationCalls[0].message, /01:00:00/);
  assert.match(fixture.state.confirmationCalls[1].message, /02:00:00/);
});

test('pending time confirmation blocks duplicate resets and applies only the accepted action', async () => {
  const confirmation = deferred();
  const fixture = await createFixture({
    initialState: { overtime: { initialSeconds: 3600 } },
    parsedDuration: 7200,
    confirmImpl: () => confirmation.promise,
  });
  const reset = fixture.document.getElementById('overtimeResetBtn');
  const apply = fixture.document.getElementById('overtimeApplyTimeBtn');
  const pendingReset = reset.dispatchEvent('click');
  await reset.dispatchEvent('click');
  await apply.dispatchEvent('click');
  assert.equal(fixture.state.confirmationCalls.length, 1);
  assert.equal(fixture.state.apiCalls.length, 0);
  confirmation.resolve(true);
  await pendingReset;
  assert.equal(fixture.state.apiCalls.length, 1);
  assert.equal(fixture.state.apiCalls[0].url, '/api/overtime/action');
  assert.equal(fixture.state.apiCalls[0].body.action, 'reset');

  await apply.dispatchEvent('click');
  assert.equal(fixture.state.apiCalls.length, 2);
  assert.equal(fixture.state.apiCalls[1].url, '/api/overtime/time');
  assert.equal(fixture.state.apiCalls[1].body.initialSeconds, 7200);
  assert.equal(fixture.state.apiCalls[1].body.remainingSeconds, 7200);
});

test('one start saves the duration and rules once, then pause and resume preserve accumulated time', async (t) => {
  const backend = createServiceFixture();
  const service = backend.createService();
  t.after(() => { service.dispose(); backend.close(); });
  const saving = deferred();
  const fixture = await createFixture({
    initialState: { overtime: service.getSnapshot() },
    parsedDuration: 7200,
    async apiImpl(url, body) {
      if (body.action === 'start') {
        await saving.promise;
      }
      return { data: url.endsWith('/time') ? service.setTime(body) : service.act(body.action, body) };
    },
  });
  await fixture.document.getElementById('overtimeRules').dispatchEvent('input');
  const primary = fixture.document.getElementById('overtimeStartBtn');
  const starting = primary.dispatchEvent('click');
  await primary.dispatchEvent('click');
  assert.equal(service.getSnapshot().enabled, false, 'wait for the rule save before enabling receipt');
  saving.resolve();
  await starting;
  assert.equal(service.getSnapshot().status, 'running');
  assert.equal(service.getSnapshot().effectiveRemainingMs, 7200000);
  assert.equal(fixture.state.apiCalls.filter(({ body }) => Array.isArray(body.rules)).length, 1);
  assert.equal(fixture.state.apiCalls.filter(({ body }) => body.action === 'start').length, 1);
  backend.clock.advance(25000);
  await primary.dispatchEvent('click');
  const remaining = service.getSnapshot().effectiveRemainingMs;
  assert.equal(service.getSnapshot().status, 'paused');
  await primary.dispatchEvent('click');
  assert.equal(service.getSnapshot().status, 'running');
  assert.equal(service.getSnapshot().effectiveRemainingMs, remaining);
  assert.equal(fixture.state.apiCalls.filter(({ url }) => url.endsWith('/time')).length, 0);
  assert.equal(fixture.state.confirmationCalls.length, 0);
});

test('a failed rule save prevents start and a cancelled replacement preserves the countdown', async () => {
  const failure = new Error('保存失败');
  const fixture = await createFixture({
    initialState: { overtime: { enabled: true, initialSeconds: 3600, effectiveRemainingMs: 9000000, status: 'paused' } },
    parsedDuration: 3600,
    apiImpl: async () => { throw failure; },
  });
  await fixture.document.getElementById('overtimeRules').dispatchEvent('input');
  const primary = fixture.document.getElementById('overtimeStartBtn');
  await primary.dispatchEvent('click');
  assert.equal(fixture.state.lastError, failure);
  assert.equal(fixture.state.apiCalls.length, 1);
  assert.equal(fixture.state.apiCalls[0].url, '/api/overtime/action');
  fixture.state.parsedDuration = 7200;
  fixture.state.confirmImpl = async () => false;
  await primary.dispatchEvent('click');
  assert.equal(fixture.state.confirmationCalls.length, 1);
  assert.equal(fixture.state.apiCalls.length, 1, 'cancelling cannot change time or start');
});

test('a gift settling while start is in flight is preserved and retry resumes the accumulated time', async (t) => {
  const backend = createServiceFixture();
  let frontend;
  const service = backend.createService({ onUpdate: (update) => frontend?.namespace.eventBus.emit(frontend.namespace.Events.OVERTIME_UPDATED, update) });
  t.after(() => { service.dispose(); backend.close(); });
  service.setTime({ initialSeconds: 60, remainingSeconds: 0 });
  service.act('enable');
  service.replaceRules([fixedRule('gift-a', 300)]);
  const gate = deferred();
  frontend = await createFixture({
    initialState: { overtime: service.getSnapshot() }, parsedDuration: 60,
    readOverview: async () => ({ payload: { ok: true, data: service.getOverview() } }),
    async apiImpl(url, body) {
      await gate.promise;
      return { data: url.endsWith('/time') ? service.setTime(body) : url.endsWith('/rules') ? service.replaceRules(body.rules) : service.act(body.action, body) };
    },
  });
  const start = frontend.document.getElementById('overtimeStartBtn');
  const pending = start.dispatchEvent('click');
  service.finalizeGift(backend.insertFinalGift({ overtimeEpoch: 1 }));
  gate.resolve();
  await pending;
  assert.equal(service.getSnapshot().effectiveRemainingMs, 300_000);
  assert.equal(frontend.state.lastError?.statusCode, 409);
  await start.dispatchEvent('click');
  assert.equal(service.getSnapshot().status, 'running');
  assert.equal(service.getSnapshot().effectiveRemainingMs, 300_000);
  service.finalizeGift(backend.insertFinalGift({ overtimeEpoch: 1 }));
  assert.equal(service.getSnapshot().effectiveRemainingMs, 600_000, 'a gift after start settles normally');
});

test('disabling and reconnecting reconcile pending counts and terminal settlements', async (t) => {
  const backend = createServiceFixture();
  let frontend;
  let connected = true;
  const service = backend.createService({ onUpdate: update => {
    if (connected) frontend?.namespace.eventBus.emit(frontend.namespace.Events.OVERTIME_UPDATED, update);
  } });
  t.after(() => { service.dispose(); backend.close(); });
  service.act('enable');
  const pending = backend.insertProgressGift({ overtimeEpoch: 1 });
  service.observeGift(pending);
  frontend = await createFixture({ initialState: { overtime: service.getOverview() },
    readOverview: async () => ({ payload: { ok: true, data: service.getOverview() } }),
  });
  const count = () => Number(frontend.document.getElementById('overtimePendingCount').textContent.match(/\d+/)[0]);
  assert.equal(count(), 1);
  service.act('disable');
  await flush();
  assert.equal(count(), 0);
  assert.equal(frontend.state.settlements[0].status, 'ignored');
  connected = false;
  service.act('enable');
  const another = backend.insertProgressGift({ overtimeEpoch: 2 });
  service.observeGift(another);
  frontend.namespace.eventBus.emit(frontend.namespace.Events.STATE_LOADED, {
    state: { overtime: service.getSnapshot() }, isConnectionSnapshot: true,
  });
  await flush();
  assert.equal(count(), 1);
  service.act('disable');
  frontend.namespace.eventBus.emit(frontend.namespace.Events.STATE_LOADED, {
    state: { overtime: service.getSnapshot() }, isConnectionSnapshot: true,
  });
  await flush();
  assert.equal(count(), 0);
  assert.equal(frontend.state.settlements[0].giftEventId, another.giftEventId);
});

async function createOverviewReplay(t) {
  const backend = createServiceFixture();
  let send;
  const service = backend.createService({ onUpdate: update => send?.({ type: 'overtime:update', ...update }) });
  t.after(() => { service.dispose(); backend.close(); });
  service.act('enable');
  const gift = backend.insertProgressGift({ overtimeEpoch: service.getCurrentEpoch() });
  service.observeGift(gift);
  const reads = [];
  const frontend = await createFixture({
    initialState: { overtime: service.getOverview() },
    readOverview(options) {
      const read = { ...deferred(), data: service.getOverview(), signal: options?.signal };
      reads.push(read);
      return read.promise;
    },
    apiImpl: async (url, body) => ({ data: service.act(body.action, body) }),
  });
  const deliver = async (index, data = reads[index].data) => {
    reads[index].resolve({ payload: { ok: true, data } });
    await flush();
  };
  const count = () => Number(frontend.document.getElementById('overtimePendingCount').textContent.match(/\d+/)[0]);
  await deliver(0);
  assert.equal(count(), 1);
  service.act('disable');
  assert.equal(backend.getSettlement(gift.giftEventId).status, 'ignored');
  const { eventBus, Events } = frontend.namespace;
  const { StateService } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/state.js'), {
    WebSocket: EventTarget, window: frontend.window, location: { protocol: 'http:', host: 'fixture.test' },
  }, { moduleFixtures: new Map([[path.join(ROOT_DIR, 'public/js/shared/event-bus.js'), { eventBus, Events }]]) });
  const admin = new StateService();
  admin.connectSocket();
  send = payload => admin.ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }));
  const reconnect = (overtime = service.getSnapshot()) => send({ type: 'snapshot', reason: 'connect', state: { overtime } });
  reconnect();
  return { backend, service, frontend, gift, reads, deliver, count, reconnect };
}

test('enable and then reset each overtake an overview and the host recovers the ignored gift', async t => {
  const { frontend, service, gift, reads, deliver, count } = await createOverviewReplay(t);
  await frontend.document.getElementById('overtimeEnableBtn').dispatchEvent('click');
  await deliver(1);
  await frontend.document.getElementById('overtimeResetBtn').dispatchEvent('click');
  await deliver(2);
  assert.deepEqual(reads.map(r => r.data.revision), [1, 2, 3, 4]);
  await deliver(3);
  assert.deepEqual(frontend.state.apiCalls.map(call => call.body.action), ['enable', 'reset']);
  assert.equal(count(), service.getOverview().pendingCount);
  assert.equal(count(), 0);
  assert.equal(frontend.state.settlements[0].giftEventId, gift.giftEventId);
  assert.equal(frontend.state.settlements[0].status, 'ignored');
  assert.equal(reads.length, 4);
});

test('a burst of settled gifts shares one outstanding read and a full disable broadcast satisfies it', async t => {
  const { backend, service, frontend, gift, reads, deliver, count, reconnect } = await createOverviewReplay(t);
  service.act('enable');
  service.replaceRules([fixedRule('gift-a', 5)]);
  const applied = [];
  for (let i = 0; i < 8; i++) {
    const final = backend.insertFinalGift({ overtimeEpoch: service.getCurrentEpoch() });
    service.finalizeGift(final);
    applied.unshift(final.giftEventId);
  }
  assert.equal(reads.length, 2, 'all eight adjustment broadcasts join the reconnect request');
  await deliver(1);
  await deliver(2);
  assert.equal(reads.length, 3);
  assert.equal(count(), 0);
  assert.deepEqual(frontend.state.settlements.map(row => row.giftEventId), [...applied, gift.giftEventId]);
  assert.equal(frontend.state.settlements[0].status, 'applied');

  const pending = backend.insertProgressGift({ overtimeEpoch: service.getCurrentEpoch() });
  service.observeGift(pending);
  reconnect();
  service.act('disable');
  await deliver(3);
  assert.equal(frontend.state.settlements[0].giftEventId, pending.giftEventId);
  assert.equal(frontend.state.settlements[0].status, 'ignored');
  assert.equal(count(), 0);
  assert.equal(reads.length, 4, 'the full broadcast covers this request');
});

test('a same-revision overview fills in the ignored row while preserving newer quantity-limit counts', async t => {
  const { backend, service, frontend, gift, reads, deliver, count } = await createOverviewReplay(t);
  service.act('enable');
  service.replaceRules([{ giftId: 'gift-a', giftName: 'A', mode: 'random', quantityMode: 'item', enabled: true,
    outcomes: [{ operation: 'add', value: 1, weight: 1 }, { operation: 'subtract', value: 1, weight: 1 }] }]);
  await deliver(1);
  const limited = backend.insertFinalGift({ overtimeEpoch: service.getCurrentEpoch(), num: 100001 });
  assert.throws(() => service.finalizeGift(limited), { code: 'OVERTIME_QUANTITY_LIMIT' });
  assert.equal(service.getSnapshot().revision, reads[2].data.revision);
  assert.equal(reads[2].data.pendingCount, 0);
  await deliver(2);
  assert.equal(reads.length, 3);
  assert.equal(count(), service.getOverview().pendingCount);
  assert.match(frontend.document.getElementById('overtimePendingCount').textContent, /1 笔数量超限/);
  assert.equal(frontend.state.settlements[0].giftEventId, gift.giftEventId);
  assert.equal(frontend.state.settlements[0].status, 'ignored');
});

test('reconnect discards the prior connection’s pending overview even when its revision is higher', async t => {
  const { service, frontend, reads, deliver, count, reconnect } = await createOverviewReplay(t);
  service.act('enable');
  await deliver(1);
  reconnect({ revision: 0, pendingCount: 0, settlements: [] });
  assert.equal(reads[2].signal.aborted, true);
  await deliver(2);
  assert.deepEqual(frontend.state.settlements, []);
  await deliver(3, { revision: 0, pendingCount: 2, settlements: [] });
  assert.equal(count(), 2);
  assert.equal(reads.length, 4);
});

test('failed and persistently historical overviews stop until the next reconciliation trigger', async t => {
  const { service, frontend, gift, reads, deliver, count, reconnect } = await createOverviewReplay(t);
  service.act('enable');
  await deliver(1);
  service.act('reset');
  reads[2].reject(new Error('offline'));
  await flush();
  frontend.clock.tick(60000);
  await flush();
  assert.equal(reads.length, 3);
  assert.equal(frontend.state.lastError.message, 'offline');
  assert.equal(count(), 1);
  assert.deepEqual(frontend.state.settlements, []);
  reconnect();
  await deliver(3, reads[1].data);
  assert.equal(reads.length, 4, 'a historical response alone cannot start another GET');
  reconnect();
  await deliver(4);
  assert.equal(count(), 0);
  assert.equal(frontend.state.settlements[0].giftEventId, gift.giftEventId);
  assert.equal(reads.length, 5);
});

for (const exit of ['shutdown', 'pagehide']) {
  test(`overtime ${exit} cancels the superseded read and ignores late settlement work`, async t => {
    const { service, frontend, reads, deliver, count, reconnect } = await createOverviewReplay(t);
    service.act('enable');
    await deliver(1);
    service.act('reset');
    if (exit === 'shutdown') frontend.namespace.eventBus.emit('app:shutdown');
    else frontend.window.dispatchEvent(new Event('pagehide'));
    assert.equal(reads[2].signal?.aborted, true);
    await deliver(2);
    reconnect();
    service.act('disable');
    assert.equal(reads.length, 3);
    assert.equal(count(), 1);
    assert.deepEqual(frontend.state.settlements, []);
    assert.equal(frontend.state.lastError, undefined);
  });
}

function readOvertimeAdminSource() {
  return fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime.js'), 'utf8');
}

test('overtime renderer does not inject untrusted labels through HTML', () => {
  const source = readOvertimeAdminSource();
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('overtime duration converts hours and minutes and rejects invalid values', async () => {
  const { createOvertimeTimeView } = await loadModuleExports(
    path.join(ROOT_DIR, 'public/js/admin/overtime-time-view.js'),
  );
  const values = {};
  const view = createOvertimeTimeView({
    getServerLimits: () => ({ maxSeconds: 315328464000 }),
    setValueUnlessFocused: (id, value) => { values[id] = value; },
  });
  assert.equal(view.parseInitialDuration('2:05'), 7500);
  view.renderInitialDuration(7500);
  assert.deepEqual(values, {
    overtimeInitialHours: '2',
    overtimeInitialMinutes: '5',
  });
  assert.throws(() => view.parseInitialDuration('02:05:30'));
  assert.throws(() => view.parseInitialDuration('02:60'));
});

test('initial duration drafts survive realtime updates and accepted long values keep their seconds', async () => {
  const { createOvertimeTimeView } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/overtime-time-view.js'));
  const nodes = { overtimeInitialHours: { value: '' }, overtimeInitialMinutes: { value: '' } };
  const view = createOvertimeTimeView({
    byId: (id) => nodes[id],
    getServerLimits: () => ({ maxSeconds: 315328464000 }),
    setValueUnlessFocused: (id, value) => { nodes[id].value = value; },
  });
  view.renderInitialDuration(0);
  nodes.overtimeInitialHours.value = '2';
  view.markDurationDirty();
  view.renderInitialDuration(0);
  assert.equal(view.readInitialDuration(), 7200, 'enabling and gift updates cannot erase the draft');
  view.acceptInitialDuration(7200);
  view.renderInitialDuration(1000 * 3600 + 125);
  assert.equal(view.readInitialDuration(), 1000 * 3600 + 125, 'resume must not truncate saved seconds');
});

test('overtime rule inputs preserve effect units and reject invalid factors', async () => {
  const { readRules } = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime-rule-model.js'));
  const durationRoot = (operation, hours, minutes, seconds, factor = 2) => {
    const root = {
      dataset: {
        giftId: 'gift-1',
        giftName: '测试礼物',
        imagePath: '',
      },
      querySelector(selector) {
        if (selector === '[data-rule-mode]:checked') return { value: 'fixed' };
        if (selector === '[data-rule-quantity-mode]:checked') return { value: 'group' };
        if (selector === '[data-rule-enabled]') return { checked: true };
        if (selector === '[data-effect-mode="fixed"]') return root;
        if (selector === '[data-rule-operation]:checked') return { value: operation };
        if (selector === '[data-effect-factor]') return { value: factor };
        if (selector === '[data-duration-hours]') return { value: hours };
        if (selector === '[data-duration-minutes]') return { value: minutes };
        if (selector === '[data-duration-seconds]') return { value: seconds };
        return null;
      },
      querySelectorAll() {
        return [];
      },
    };
    return { querySelectorAll: () => [root] };
  };
  const readFixedEffect = (...args) =>
    readRules(durationRoot(...args), {
      maxEnabledRules: 8,
      minRandomOutcomes: 2,
      maxRandomOutcomes: 10,
      maxDisplayTextLength: 100,
    })[0].fixedEffect;
  assert.equal(
    JSON.stringify(readFixedEffect('add', '1', '2', '3')),
    JSON.stringify({ operation: 'add', value: 3723 }),
  );
  assert.equal(
    JSON.stringify(readFixedEffect('multiply', '', '', '', '8')),
    JSON.stringify({ operation: 'multiply', value: 8 }),
  );
  assert.equal(JSON.stringify(readFixedEffect('clear', '', '', '')), JSON.stringify({ operation: 'clear', value: 0 }));
  assert.throws(() => readFixedEffect('divide', '', '', '', '1'));
  assert.equal(
    JSON.stringify(readFixedEffect('add', '999', '0', '0')),
    JSON.stringify({ operation: 'add', value: 999 * 3600 }),
  );
});
