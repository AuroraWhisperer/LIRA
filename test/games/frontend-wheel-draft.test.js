'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');
const { readAdminFragmentHtml } = require('../helpers/admin-html');

const fixture = createUiFixture();

test('wheel drafts block spins, survive broadcasts and can retry a failed save', async (t) => {
  const page = await fixture(t, 'wheel');
  await page.setContent(readAdminFragmentHtml('pages/admin/toolbox/games.html'));
  await page.evaluate(async () => {
    document.getElementById('otherGamesFeature').hidden = false;
    window.wheelData = {
      entries: [{ label: '唱歌', weight: 1 }, { label: '跳舞', weight: 2 }],
      limits: { minEntries: 2, maxEntries: 10, minWeight: 1, maxWeight: 100, maxLabelLength: 20 },
      totalWeight: 3, spin: null, lastResult: null,
    };
    window.fetch = async () => ({ json: async () => ({ ok: true, data: window.wheelData }) });
    const { initWheelAdmin } = await import('/js/admin/games-wheel.js');
    await initWheelAdmin();
  });
  await page.locator('#wheelCardTrigger').click();
  assert.equal(await page.locator('#wheelSpinBtn').isEnabled(), true);
  await page.locator('.wheel-label-input').first().fill('新的选项');
  await page.locator('.wheel-weight-input').first().fill('5');
  assert.equal(await page.locator('#wheelSpinBtn').isDisabled(), true);
  assert.match(await page.locator('#wheelStatus').textContent(), /未保存/);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('app:wheel-update', { detail: window.wheelData })));
  assert.equal(await page.locator('.wheel-label-input').first().inputValue(), '新的选项');
  assert.equal(await page.locator('#wheelTotalWeight').textContent(), '总份数 7');
  await page.locator('#wheelSpinBtn').dispatchEvent('click');
  assert.equal(await page.evaluate(() => window.pendingSaves.length), 0);
  await page.locator('#wheelSaveBtn').click();
  assert.equal(await page.locator('.wheel-label-input').first().isDisabled(), true);
  await page.evaluate(() => window.pendingSaves.shift().reject(new Error('临时保存失败')));
  await page.waitForFunction(() => !document.getElementById('wheelSaveBtn').disabled);
  assert.equal(await page.locator('#wheelSpinBtn').isDisabled(), true);
  assert.equal(await page.locator('.wheel-label-input').first().inputValue(), '新的选项');
  await page.locator('#wheelSaveBtn').click();
  await page.evaluate(() => {
    const save = window.pendingSaves.shift();
    window.wheelData.entries = save.body.entries;
    save.resolve({ data: window.wheelData });
  });
  await page.waitForFunction(() => !document.getElementById('wheelSpinBtn').disabled);
  await page.locator('#wheelSpinBtn').click();
  assert.deepEqual(await page.evaluate(() => window.pendingSaves.map((call) => call.url)), ['/api/wheel/spin']);
  await page.evaluate(() => window.pendingSaves.shift().resolve({ data: { ...window.wheelData, spin: {} } }));
  await page.waitForFunction(() => document.getElementById('wheelStatus').textContent.includes('正在转动'));
  assert.equal(await page.locator('.wheel-label-input').first().isDisabled(), true);
});

test('wheel drafts compare against the latest saved options after a background update', async (t) => {
  const page = await fixture(t, 'wheel');
  await page.setContent(readAdminFragmentHtml('pages/admin/toolbox/games.html'));
  await page.evaluate(async () => {
    document.getElementById('otherGamesFeature').hidden = false;
    window.wheel = await import('/js/admin/games-wheel.js');
    window.wheelData = {
      entries: [{ label: '原选项', weight: 1 }, { label: '另一个', weight: 1 }],
      limits: { minEntries: 2, maxEntries: 10, minWeight: 1, maxWeight: 100, maxLabelLength: 20 },
      spin: null,
    };
    window.fetch = async () => ({ json: async () => ({ ok: true, data: window.wheelData }) });
    await window.wheel.initWheelAdmin();
  });
  await page.locator('#wheelCardTrigger').click();
  await page.locator('.wheel-label-input').first().fill('本地草稿');
  await page.evaluate(() => {
    window.wheelData.entries[0].label = '其他入口保存的选项';
    window.wheel.renderWheelState(window.wheelData);
  });
  assert.equal(await page.locator('.wheel-label-input').first().inputValue(), '本地草稿');
  await page.locator('.wheel-label-input').first().fill('原选项');
  assert.equal(await page.locator('#wheelSpinBtn').isDisabled(), true);
});
