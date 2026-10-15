'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { FakeNode } = require('../helpers/fake-dom');

test('admin overtime clock schedules displayed boundaries and preserves updates, pause and visibility', async t => {
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const frames = new Map();
  const nodes = new Map();
  const document = { visibilityState: 'visible' };
  const byId = id => {
    if (!nodes.has(id)) nodes.set(id, Object.assign(new FakeNode(), { classList: { toggle() {} } }));
    return nodes.get(id);
  };
  const { formatClockDisplay } = await loadModuleExports(path.join(__dirname, '../../public/js/shared/overtime-time-format.js'));
  const { createOvertimeStatusView } = await loadModuleExports(path.join(__dirname, '../../public/js/admin/overtime-status-view.js'), {
    document, performance: { now: () => now },
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, at: now + delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => { frames.set(++timerId, callback); return timerId; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  const view = createOvertimeStatusView({ byId, formatClockDisplay, renderInitialDuration() {},
    getGiftDetection: () => ({}), getRuleEditor: () => null, isRulesDirty: () => false, onLimits() {} });
  t.after(() => view.stopClockLoop());
  const advance = milliseconds => {
    now += milliseconds;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  };
  const render = (revision, effectiveRemainingMs, status = 'running') =>
    view.renderState({ revision, effectiveRemainingMs, status, enabled: true });
  const value = () => byId('overtimeClockValue').textContent;
  render(1, 5000);
  assert.equal(frames.size, 0, 'a second-resolution clock needs no animation-frame loop');
  assert.equal(value(), '00:00:05');
  assert.equal(timers.size, 1);
  advance(999);
  assert.equal(value(), '00:00:05');
  advance(1);
  assert.equal(value(), '00:00:04');
  render(2, 7500);
  assert.equal(value(), '00:00:08', 'an adjustment is rendered immediately');
  assert.equal(timers.size, 1, 'a new anchor replaces the old timer');
  advance(500);
  assert.equal(value(), '00:00:07');
  render(3, 7000, 'paused');
  assert.equal(timers.size, 0);
  advance(5000);
  assert.equal(value(), '00:00:07');
  render(4, 7000);
  document.visibilityState = 'hidden';
  view.syncClockLoop();
  assert.equal(timers.size, 0);
  advance(2500);
  document.visibilityState = 'visible';
  view.syncClockLoop();
  assert.equal(value(), '00:00:05');
  advance(500);
  assert.equal(value(), '00:00:04');
  render(5, 86400000 + 30000);
  const timerBefore = timerId;
  advance(29000);
  assert.equal(value(), '1天 00:00');
  assert.equal(timerId, timerBefore, 'calendar display sleeps until its next boundary');
  advance(1000);
  advance(1000);
  assert.equal(value(), '23:59:59');
  render(6, 0);
  assert.equal(value(), '该下播了');
  assert.equal(timers.size, 0);
  render(7, 1000);
  view.stopClockLoop();
  assert.equal(timers.size, 0);
  render(8, 86400000 + 60000);
  assert.equal(value(), '1天 00:01');
  advance(1000);
  assert.equal(value(), '1天 00:00', 'calendar minutes change after the rounded second crosses the boundary');
  assert.equal([...timers.values()][0].at - now, 60000, 'the next unchanged minute still sleeps');
  render(9, 365 * 86400000 + 3600000);
  assert.equal(value(), '1年 0天 1小时');
  advance(1000);
  assert.equal(value(), '1年 0天 0小时');
});
