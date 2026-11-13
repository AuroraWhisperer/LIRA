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

test('gift appearance choices preview independently, save, and restore without losing incoming settings', async (t) => {
  const page = await openSettings(t);
  await page.evaluate(async () => {
    const { enhanceSelects } = await import('/js/shared/select-menu.js');
    enhanceSelects(document.getElementById('giftDisplayForm'));
  });
  const tail = page.locator('#giftTailStyle');
  const texture = page.locator('#giftTextureStyle');
  const sheen = page.locator('#giftSheen');
  assert.equal(await tail.inputValue(), 'slant');
  assert.equal(await texture.inputValue(), 'solid');
  await page.getByRole('button', { name: '条带外形', exact: true }).click();
  await page.getByRole('option', { name: '圆角胶囊', exact: true }).click();
  assert.equal(await page.locator('#giftStylePreview .gift-banner').first().getAttribute('data-tail-style'), 'capsule');
  await page.getByRole('button', { name: '条带内部', exact: true }).click();
  await page.getByRole('option', { name: '蕾丝花边', exact: true }).click();
  assert.equal(await page.locator('#giftStylePreview .gift-banner').first().getAttribute('data-texture-style'), 'lace');
  await sheen.check();
  assert.equal(await page.locator('#giftStylePreview .gift-banner').first().getAttribute('data-sheen'), 'true');
  await page.getByRole('button', { name: '保存滚动与样式设置', exact: true }).click();
  await page.waitForFunction(() => window.displaySaves.length === 1 && !document.getElementById('giftDisplayFields').disabled);
  assert.equal(await page.evaluate(() => window.savedDisplay.tailStyle), 'capsule');
  assert.equal(await page.evaluate(() => window.savedDisplay.textureStyle), 'lace');
  assert.equal(await page.evaluate(() => window.savedDisplay.sheen), true);
  await sheen.uncheck();
  await page.getByRole('button', { name: '条带内部', exact: true }).click();
  await page.getByRole('option', { name: '丝缎流光', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('app:settings-state', {
    detail: { giftDisplayConfig: JSON.stringify({ ...window.savedDisplay, tailStyle: 'slant', visibleRows: 5 }) },
  })));
  assert.equal(await tail.inputValue(), 'slant');
  assert.equal(await texture.inputValue(), 'satin');
  await page.locator('#giftDisplayCancel').click();
  assert.equal(await texture.inputValue(), 'lace');
  assert.equal(await sheen.isChecked(), true);
  assert.equal(await page.locator('#giftFeedRows').inputValue(), '5');
  await page.evaluate(() => {
    const fetchConfig = window.fetch;
    window.fetch = (url, options = {}) => {
      if (options.method !== 'POST') return fetchConfig(url, options);
      const submitted = JSON.parse(options.body);
      window.displaySaves.push(submitted);
      return new Promise(resolve => {
        window.finishDisplaySave = () => {
          window.savedDisplay = { ...submitted, scrollSpeed: 40 };
          window.dispatchEvent(new CustomEvent('app:settings-state', {
            detail: { giftDisplayConfig: JSON.stringify(window.savedDisplay) },
          }));
          resolve({ ok: true, json: async () => ({ ok: true, data: submitted }) });
        };
      });
    };
  });
  await page.locator('#giftFeedSpeed').fill('50');
  await page.getByRole('button', { name: '保存滚动与样式设置', exact: true }).click();
  await page.waitForFunction(() => typeof window.finishDisplaySave === 'function');
  await page.evaluate(() => window.finishDisplaySave());
  await page.waitForFunction(() => !document.getElementById('giftDisplayFields').disabled);
  assert.equal(await page.locator('#giftFeedSpeed').inputValue(), '40');
  await page.locator('#giftDisplayDefaults').click();
  assert.equal(await tail.inputValue(), 'slant');
  assert.equal(await texture.inputValue(), 'solid');
  assert.equal(await sheen.isChecked(), false);
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
