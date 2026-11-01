'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');
const fixture = createUiFixture();

test('sprint overlay follows updates, reset and reconnect without stale text', async (t) => {
  const page = await fixture(t, 'sprint-overlay');
  await page.setContent(fs.readFileSync('public/pages/overlays/gift-sprint.html', 'utf8').replace(/<script[\s\S]*?<\/script>/, ''));
  await page.evaluate(async () => {
    history.replaceState(null, '', '/gift-sprint');
    await import('/js/overlays/gift-sprint.js');
    window.pushSprint = (giftSprint) => window.socketOptions.onMessage({ type: 'snapshot', state: { giftSprint } });
  });
  await page.evaluate(() => window.pushSprint({ targetRmb: 1000, remainingCrystalBalls: 7 }));
  assert.equal(await page.locator('#giftSprintText').textContent(), '还差 7 个水晶球');
  await page.evaluate(() => window.pushSprint({ targetRmb: 0, remainingCrystalBalls: 0 }));
  assert.equal(await page.locator('#giftSprintText').isVisible(), false);
  await page.evaluate(() => {
    window.pushSprint({ targetRmb: 1000, remainingCrystalBalls: 4 });
    window.socketOptions.onClose();
  });
  assert.equal(await page.locator('#giftSprintText').textContent(), '');
  await page.evaluate(() => window.pushSprint({ targetRmb: 1000, remainingCrystalBalls: 2 }));
  assert.equal(await page.locator('#giftSprintText').textContent(), '还差 2 个水晶球');
});
