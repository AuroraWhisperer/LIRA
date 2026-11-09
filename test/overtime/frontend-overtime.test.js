'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createFixture, deferred } = require('../helpers/overtime-gift-picker-fixture');
const { createFixture: createServiceFixture } = require('../helpers/overtime-service-fixture');

const ROOT_DIR = path.join(__dirname, '../..');

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
  assert.match(fixture.state.confirmationCalls[0].message, /3600 秒/);
  assert.match(fixture.state.confirmationCalls[1].message, /7200 秒/);
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
      if (url.endsWith('/rules')) {
        await saving.promise;
        return { data: service.replaceRules(body.rules) };
      }
      return { data: url.endsWith('/time') ? service.setTime(body) : service.act(body.action) };
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
  assert.equal(fixture.state.apiCalls.filter(({ url }) => url.endsWith('/rules')).length, 1);
  assert.equal(fixture.state.apiCalls.filter(({ body }) => body.action === 'start').length, 1);
  backend.clock.advance(25000);
  await primary.dispatchEvent('click');
  const remaining = service.getSnapshot().effectiveRemainingMs;
  assert.equal(service.getSnapshot().status, 'paused');
  await primary.dispatchEvent('click');
  assert.equal(service.getSnapshot().status, 'running');
  assert.equal(service.getSnapshot().effectiveRemainingMs, remaining);
  assert.equal(fixture.state.apiCalls.filter(({ url }) => url.endsWith('/time')).length, 1);
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
  assert.equal(fixture.state.apiCalls[0].url, '/api/overtime/rules');
  fixture.state.parsedDuration = 7200;
  fixture.state.confirmImpl = async () => false;
  await primary.dispatchEvent('click');
  assert.equal(fixture.state.confirmationCalls.length, 1);
  assert.equal(fixture.state.apiCalls.length, 1, 'cancelling cannot change time or start');
});

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
