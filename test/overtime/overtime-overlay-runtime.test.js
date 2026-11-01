'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');

const fixture = createUiFixture();

async function sendSnapshot(page, overtime) {
  await page.evaluate((overtime) => window.socketOptions.onMessage({ type: 'snapshot', state: { overtime } }), overtime);
}

test('overtime overlay tickets describe every enabled rule effect and status labels follow the state', async (t) => {
  const page = await fixture(t, 'overlay');
  const rules = [
    { giftId: 'random', giftName: '随机礼物', mode: 'random' },
    { giftId: 'display', giftName: '展示礼物', mode: 'display', displayText: '谢谢支持' },
    { giftId: 'add', giftName: '加时礼物', mode: 'fixed', fixedSeconds: 300 },
    { giftId: 'subtract', giftName: '减时礼物', mode: 'fixed', fixedSeconds: -90 },
    { giftId: 'multiply', giftName: '翻倍礼物', mode: 'fixed', fixedEffect: { operation: 'multiply', value: 8 } },
    { giftId: 'divide', giftName: '减半礼物', mode: 'fixed', fixedEffect: { operation: 'divide', value: 2 } },
    { giftId: 'clear', giftName: '清零礼物', mode: 'fixed', fixedEffect: { operation: 'clear', value: 0 } },
  ].map((rule) => ({ ...rule, enabled: true }));
  const disabled = { giftId: 'disabled', giftName: '停用礼物', mode: 'fixed', fixedSeconds: 1, enabled: false };
  await sendSnapshot(page, { revision: 1, status: 'paused', effectiveRemainingMs: 60_000, rules: [...rules, disabled] });
  const tickets = () =>
    page.evaluate(() => ({
      guideHidden: document.getElementById('overtimeGiftGuide').hidden,
      status: document.getElementById('overtimeStatusText').hidden ? null : document.getElementById('overtimeStatusText').textContent,
      items: [...document.querySelectorAll('#overtimeTickets .overtime-ticket')].map((ticket) => [
        ticket.dataset.giftId,
        ticket.querySelector('.overtime-ticket-effect').textContent,
      ]),
    }));
  assert.deepEqual(await tickets(), {
    guideHidden: false,
    status: '已暂停',
    items: [
      ['random', '盲盒'],
      ['display', '谢谢支持'],
      ['add', '加时5分'],
      ['subtract', '减时1分30秒'],
      ['multiply', '时间×8'],
      ['divide', '时间÷2'],
      ['clear', '时间清零'],
    ],
  });
  await sendSnapshot(page, { revision: 2, status: 'running', effectiveRemainingMs: 60_000, rules: [disabled] });
  assert.deepEqual(await tickets(), { guideHidden: true, status: null, items: [] });
});

test('overtime clock schedules work only for displayed-value boundaries while running and visible', async (t) => {
  const page = await fixture(t, 'overlay');
  await page.clock.install();
  const dayMs = 24 * 60 * 60 * 1000;
  await page.evaluate(({ remaining }) => {
    window.socketOptions.onMessage({
      type: 'snapshot',
      state: { overtime: { revision: 1, status: 'running', effectiveRemainingMs: remaining + 5_000, serverNowMs: Date.now() - 5_000, rules: [] } },
    });
    const schedule = window.setTimeout;
    window.clockTimers = 0;
    window.setTimeout = (...args) => {
      window.clockTimers += 1;
      return schedule(...args);
    };
  }, { remaining: dayMs + 30_000 });
  const clock = () => page.locator('#overtimeClock').textContent();
  const timers = () => page.evaluate(() => window.clockTimers);
  assert.equal(await clock(), '1天 00:00');
  // The calendar tier waits for the day boundary instead of ticking every second.
  await page.clock.runFor(29_000);
  assert.equal(await timers(), 0);
  assert.equal(await clock(), '1天 00:00');
  await page.clock.runFor(2_000);
  assert.equal(await clock(), '23:59:59');

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.clockTimers = 0;
  });
  await page.clock.runFor(10_000);
  assert.equal(await timers(), 0);
  assert.equal(await clock(), '23:59:59');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await clock(), '23:59:49');

  await page.evaluate(() => {
    window.socketOptions.onMessage({
      type: 'snapshot',
      state: { overtime: { revision: 2, status: 'paused', effectiveRemainingMs: 5_000, rules: [] } },
    });
    window.clockTimers = 0;
  });
  await page.clock.runFor(10_000);
  assert.equal(await timers(), 0);
  assert.equal(await clock(), '00:00:05');

  await page.evaluate(({ remaining }) => {
    window.socketOptions.onMessage({
      type: 'snapshot',
      state: { overtime: { revision: 3, status: 'running', effectiveRemainingMs: remaining, serverNowMs: Date.now(), rules: [] } },
    });
  }, { remaining: dayMs + 60_000 });
  assert.equal(await clock(), '1天 00:01');
  await page.clock.runFor(1_000);
  assert.equal(await clock(), '1天 00:00');
});

test('overtime adjustment bursts keep bounded playback and combine overflow into its net result', async t => {
  const page = await fixture(t, 'overlay');
  await page.clock.install();
  await page.evaluate(() => {
    const schedule = window.setTimeout;
    const cancel = window.clearTimeout;
    window.adjustmentTimeouts = new Map();
    window.setTimeout = (callback, delay, ...args) => {
      const timer = schedule(() => {
        window.adjustmentTimeouts.delete(timer);
        callback(...args);
      }, delay);
      window.adjustmentTimeouts.set(timer, Date.now() + delay);
      return timer;
    };
    window.clearTimeout = timer => {
      window.adjustmentTimeouts.delete(timer);
      cancel(timer);
    };
    for (let revision = 1; revision <= 10; revision++) {
      window.socketOptions.onMessage({ type: 'overtime:update',
        state: { revision, status: 'paused', effectiveRemainingMs: 60_000, rules: [] },
        adjustment: { giftId: 'burst', giftName: `礼物${revision}`, quantity: 2,
          applicationCount: 2, appliedDeltaSeconds: 2 } });
    }
  });
  const stage = page.locator('#overtimeAdjustmentStage');
  const advance = async () => page.clock.runFor(await page.evaluate(() =>
    Math.min(...window.adjustmentTimeouts.values()) - Date.now()));
  assert.match(await stage.textContent(), /礼物1 ×2按数量结算 2 次/);
  for (let completed = 0; completed < 5; completed++) await advance();
  assert.match(await stage.textContent(), /连续礼物 · 净变化\+00:00:10/);
  await advance();
  assert.equal(await stage.textContent(), '');
});
