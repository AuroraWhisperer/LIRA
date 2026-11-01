'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');
const { readAdminFragmentHtml } = require('../helpers/admin-html');

const fixture = createUiFixture();
const html = readAdminFragmentHtml('pages/admin/live-components/page.html');

async function openSettings(t, { tabs = false } = {}) {
  const page = await fixture(t, 'gift-display');
  await page.setContent(html);
  await page.evaluate(async tabs => {
    document.getElementById('liveComponentsPage').classList.add('active');
    const { createFeatureNavigation } = await import('/js/admin/toolbox-navigation.js');
    const navigation = createFeatureNavigation({ pageId: 'liveComponentsPage', storagePrefix: 'admin.liveComponents' });
    navigation.initOtherPage();
    window.savedDisplay = {
      palette: 'bilibili-four',
      thresholds: [10000, 50000, 100000],
      visibleRows: 3,
      scrollSpeed: 26,
    };
    window.displaySaves = [];
    window.fetch = async (url, options = {}) => {
      if (url === '/api/overtime/gifts/catalog') {
        return { ok: true, json: async () => ({ ok: true, data: { gifts: [] } }) };
      }
      if (url !== '/api/gifts/display-settings') throw new Error(`Unexpected fetch: ${url}`);
      if (options.method === 'POST') {
        window.savedDisplay = JSON.parse(options.body);
        window.displaySaves.push(window.savedDisplay);
      }
      return { ok: true, json: async () => ({ ok: true, data: window.savedDisplay }) };
    };
    if (tabs) {
      const { initGiftAssistant } = await import('/js/admin/gift-assistant.js');
      initGiftAssistant();
      document.getElementById('giftAssistantDisplayTab').click();
    } else {
      navigation.selectFeatureById('giftDisplayFeature');
      const { createGiftDisplaySettings } = await import('/js/admin/gifts/display-settings.js');
      await createGiftDisplaySettings().open();
    }
  }, tabs);
  await page.waitForFunction(() => !document.getElementById('giftDisplayFields').disabled);
  return page;
}

test('gift feed settings save speed and cancel restores the saved value', async (t) => {
  const page = await openSettings(t);
  const speed = page.locator('#giftFeedSpeed');
  await speed.fill('50');
  await page.getByRole('button', { name: '保存滚动与样式设置', exact: true }).click();
  await page.waitForFunction(() => window.displaySaves.length === 1);
  await page.waitForFunction(() => !document.getElementById('giftDisplayFields').disabled);
  assert.equal(await page.evaluate(() => window.savedDisplay.scrollSpeed), 50);
  await speed.fill('20');
  await page.locator('#giftDisplayCancel').click();
  assert.equal(await speed.inputValue(), '50');
});

test('feed minimum accepts one decimal place and saves cents', async (t) => {
  const page = await openSettings(t);
  const amount = page.locator('#giftFeedMinAmount');
  await amount.fill('0.01');
  assert.equal(await amount.evaluate((input) => input.checkValidity()), false);
  await amount.fill('10.5');
  assert.equal(await amount.evaluate((input) => input.checkValidity()), true);
  await amount.fill('1.1');
  await page.getByRole('button', { name: '保存滚动与样式设置', exact: true }).click();
  await page.waitForFunction(() => window.displaySaves.length === 1);
  assert.equal(await page.evaluate(() => window.savedDisplay.minGiftAmountCents), 110);
});

test('gift range endpoints synchronize both ways and save exact cent boundaries', async (t) => {
  const page = await openSettings(t);
  await page.locator('#giftTierEnd0').fill('125.25');
  assert.equal(await page.locator('#giftTier1').inputValue(), '125.25');
  await page.locator('#giftTier2').fill('600.5');
  assert.equal(await page.locator('#giftTierEnd1').inputValue(), '600.5');
  await page.locator('#giftTierEnd2').fill('1200.5');
  assert.equal(await page.locator('#giftTier3').inputValue(), '1200.5');
  await page.getByRole('button', { name: '保存滚动与样式设置', exact: true }).click();
  await page.waitForFunction(() => window.displaySaves.length === 1);
  assert.deepEqual(await page.evaluate(() => window.displaySaves[0].thresholds), [12525, 60050, 120050]);
});

test('gift pages keep display drafts across navigation', async (t) => {
  const page = await openSettings(t, { tabs: true });
  await page.locator('#giftFeedRows').fill('5');
  await page.getByRole('tab', { name: '全屏礼物感谢', exact: true }).click();
  await page.getByRole('tab', { name: '全屏礼物感谢', exact: true }).press('ArrowRight');
  assert.equal(await page.locator('#giftFeedRows').inputValue(), '5');
  await page.getByRole('button', { name: '保存滚动与样式设置', exact: true }).click();
  await page.waitForFunction(() => window.displaySaves.length === 1);
  assert.equal(await page.evaluate(() => window.savedDisplay.visibleRows), 5);
});
