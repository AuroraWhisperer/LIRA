'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const fixture = createUiFixture();
const html = readAdminFragmentHtml('pages/admin/toolbox/gift.html');

async function open(t) {
  const page = await fixture(t, 'gift-assistant');
  await page.route('**/js/admin/component-preview-dialog.js', route => route.fulfill({
    contentType: 'text/javascript', body: 'export const openComponentPreview = options => { window.openedComponent = options.id; };',
  }));
  await page.setContent(html);
  await page.evaluate(async () => {
    document.getElementById('otherGiftFeature').hidden = false;
    window.fetch = async () => ({ ok: true, json: async () => ({ ok: true, data: {
      viewRevision: 'synthetic', partial: false, session: { state: 'live' }, guards: [], items: [],
    } }) });
    const { initGiftAssistant } = await import('/js/admin/gift-assistant.js');
    initGiftAssistant();
  });
  await page.getByRole('tab', { name: '礼物许愿', exact: true }).click();
  await page.waitForFunction(() => !document.getElementById('giftWishFields').disabled);
  return page;
}

test('sprint lives under wishes, opens its canvas and returns to the existing goal form', async (t) => {
  const page = await open(t);
  await page.evaluate(async () => {
    const { renderGiftSprintOverlay } = await import('/js/admin/gifts/sprint-overlay.js');
    window.renderSprintPreview = renderGiftSprintOverlay;
    document.body.insertAdjacentHTML('beforeend', '<button data-main-page="giftAssistantPage">礼物</button><form id="giftSprintForm"><input id="giftSprintTargetRmb"></form>');
    document.querySelector('[data-main-page="giftAssistantPage"]').onclick = () => { window.visitedGiftPage = true; };
    renderGiftSprintOverlay({ targetRmb: 1000, remainingCrystalBalls: 7, enabled: true });
  });
  assert.equal(await page.getByRole('tab', { name: '月底冲刺', exact: true }).count(), 0);
  assert.equal(await page.locator('#giftSprintPreview').isVisible(), false);
  await page.locator('#giftWishesPanel #giftSprintOverlayPanel > summary').click();
  assert.equal(await page.locator('#giftSprintTextPreview').textContent(), '还差 7 个水晶球');
  assert.equal(await page.locator('#giftWishesPanel').isVisible(), true);
  await page.locator('#giftSprintCopy').click();
  assert.equal(await page.evaluate(() => window.messages.filter(message => message === '月底冲刺地址已复制').length), 1);
  await page.locator('#giftSprintPreview').click();
  assert.equal(await page.evaluate(() => window.openedComponent), 'gift-sprint');
  assert.equal(await page.locator('#giftSprintOverlayUrl').inputValue(), 'http://lira-ui.test/gift-sprint');
  await page.evaluate(() => window.renderSprintPreview({ targetRmb: 1000, remainingCrystalBalls: 0 }));
  assert.equal(await page.locator('#giftSprintTextPreview.is-complete').textContent(), '还差 0 个水晶球');
  await page.evaluate(() => window.renderSprintPreview({ targetRmb: 0, remainingCrystalBalls: 0 }));
  assert.equal(await page.locator('#giftSprintTextPreview').isVisible(), false);
  assert.match(await page.locator('#giftSprintOverlayStatus').textContent(), /请先设置冲刺目标/);
  await page.locator('#giftSprintConfigure').click();
  assert.equal(await page.evaluate(() => window.visitedGiftPage), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'giftSprintTargetRmb');
});

for (const preview of [false, true]) {
  test(`sprint overlay ${preview ? 'preview' : 'source'} follows updates, reset and reconnect without stale text`, async (t) => {
    const page = await fixture(t, 'sprint-overlay');
    await page.setContent(fs.readFileSync('public/pages/overlays/gift-sprint.html', 'utf8').replace(/<script[\s\S]*?<\/script>/, ''));
    await page.evaluate(async (preview) => {
      history.replaceState(null, '', `/gift-sprint${preview ? '?preview=1' : ''}`);
      await import('/js/overlays/gift-sprint.js');
      window.pushSprint = (giftSprint) => window.socketOptions.onMessage({ type: 'snapshot', state: { giftSprint } });
    }, preview);
    for (const remainingCrystalBalls of [7, 3, 0, 10]) {
      await page.evaluate((remainingCrystalBalls) => window.pushSprint({ targetRmb: 1000, remainingCrystalBalls }), remainingCrystalBalls);
      assert.equal(await page.locator('#giftSprintText').textContent(), `还差 ${remainingCrystalBalls} 个水晶球`);
    }
    await page.evaluate(() => window.pushSprint({ targetRmb: 0, remainingCrystalBalls: 0 }));
    assert.equal(await page.locator('#giftSprintText').isVisible(), false);
    assert.equal(await page.locator('#giftSprintStatus').isVisible(), preview);
    await page.evaluate(() => {
      window.pushSprint({ targetRmb: 1000, remainingCrystalBalls: 4 });
      window.socketOptions.onClose();
    });
    assert.equal(await page.locator('#giftSprintText').textContent(), '');
    assert.equal(await page.locator('#giftSprintStatus').isVisible(), preview);
    await page.evaluate(() => window.pushSprint({ targetRmb: 1000, remainingCrystalBalls: 2 }));
    assert.equal(await page.locator('#giftSprintText').textContent(), '还差 2 个水晶球');
    assert.equal(await page.locator('#giftSprintStatus').isVisible(), false);
  });
}
