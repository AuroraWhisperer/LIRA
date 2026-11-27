'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { patchGiftDisplaySettings } = require('../../src/bilibili/gift/display-settings');

const fixture = createUiFixture();
const html = readAdminFragmentHtml('pages/admin/live-components/page.html');

async function openSettings(t, { tabs = false } = {}) {
  const page = await fixture(t, 'gift-display');
  await page.exposeFunction('applyDisplayPatch', (current, patch) =>
    patchGiftDisplaySettings({ giftDisplayConfig: JSON.stringify(current) }, patch));
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
    window.displayReads = [];
    window.displaySaves = [];
    window.displayRequests = [];
    window.fetch = async (url, options = {}) => {
      if ((options.method ?? 'GET') === 'GET') window.displayReads.push(url);
      if (url !== '/api/gifts/display-settings') throw new Error(`Unexpected fetch: ${url}`);
      if (options.method === 'POST') {
        const body = JSON.parse(options.body);
        window.displayRequests.push(body);
        if (window.failDisplaySave) return { ok: false, json: async () => ({ ok: false, error: 'offline' }) };
        window.savedDisplay = await window.applyDisplayPatch(window.savedDisplay, body.patch);
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
  page.setDefaultTimeout(7000);
  await page.clock.install();
  return page;
}

async function saveEdits(page) {
  const retry = page.locator('#giftDisplayForm button[type="submit"]');
  if (await retry.isVisible()) await retry.click();
  else await page.clock.runFor(600);
}

test('gift concurrency keeps dirty thresholds and canvas fields across an in-flight save', async t => {
  const page = await openSettings(t);
  await page.evaluate(() => {
    const fetchConfig = window.fetch;
    window.fetch = async (url, options = {}) => {
      if (options.method !== 'POST' || window.finishDisplaySave) return fetchConfig(url, options);
      const body = JSON.parse(options.body);
      window.displayRequests.push(body);
      const submitted = await window.applyDisplayPatch(window.savedDisplay, body.patch);
      window.savedDisplay = structuredClone(submitted);
      window.displaySaves.push(submitted);
      return new Promise(resolve => {
        window.finishDisplaySave = () => resolve({ ok: true, json: async () => ({ ok: true, data: submitted }) });
      });
    };
  });
  await page.locator('#giftTier1').fill('125.25');
  await page.evaluate(() => {
    window.savedDisplay.scrollSpeed = 40;
    window.dispatchEvent(new CustomEvent('app:settings-state', {
      detail: { giftDisplayConfig: JSON.stringify(window.savedDisplay) },
    }));
  });
  await saveEdits(page);
  await page.waitForFunction(() => typeof window.finishDisplaySave === 'function');
  assert.equal(await page.evaluate(() => window.displaySaves[0].thresholds[0]), 12525);
  assert.equal(await page.evaluate(() => window.displaySaves[0].scrollSpeed), 40);
  assert.deepEqual(await page.evaluate(() => window.displayRequests[0]), { patch: { threshold1: 12525 } });
  await page.locator('#giftTier1').fill('150.25');
  await page.evaluate(() => {
    window.savedDisplay.visibleRows = 5;
    window.dispatchEvent(new CustomEvent('app:settings-state', {
      detail: { giftDisplayConfig: JSON.stringify(window.savedDisplay) },
    }));
    window.finishDisplaySave();
  });
  await page.clock.runFor(1300);
  await page.waitForFunction(() => window.displaySaves.length === 2);
  assert.equal(await page.evaluate(() => window.savedDisplay.thresholds[0]), 15025);
  assert.equal(await page.evaluate(() => window.savedDisplay.scrollSpeed), 40);
  assert.equal(await page.evaluate(() => window.savedDisplay.visibleRows), 5);
  assert.equal(await page.locator('#giftTierEnd0').inputValue(), '150.25');
});

test('gift concurrency preserves native decimal input across canvas snapshots and save receipts', async t => {
  for (const [id, field] of [
    ['giftTier1', 'threshold1'], ['giftTierEnd0', 'threshold1'], ['giftFeedMinAmount', 'minGiftAmountCents'],
  ]) {
    await t.test(id, async t => {
      const page = await openSettings(t);
      const amount = page.locator(`#${id}`);
      await amount.fill('12');
      await amount.press('End');
      await amount.press('.');
      await page.evaluate(() => {
        window.savedDisplay.scrollSpeed = 34;
        window.savedDisplay.thresholds[1] = 60000;
        window.dispatchEvent(new CustomEvent('app:settings-state', {
          detail: { giftDisplayConfig: JSON.stringify(window.savedDisplay) },
        }));
      });
      assert.equal(await page.locator('#giftFeedSpeed').inputValue(), '34');
      assert.equal(await page.locator('#giftTier2').inputValue(), '600');
      await saveEdits(page);
      await page.waitForFunction(() => window.displaySaves.length === 1);
      await page.clock.runFor(650);
      await amount.press('3');
      assert.equal(await amount.inputValue(), '12.3');
      await saveEdits(page);
      await page.waitForFunction(() => window.displaySaves.length === 2);
      assert.equal(await page.evaluate(() => window.savedDisplay.scrollSpeed), 34);
      assert.equal(await page.evaluate(() => window.savedDisplay.thresholds[1]), 60000);
      assert.equal(await page.evaluate(field => field === 'threshold1'
        ? window.savedDisplay.thresholds[0] : window.savedDisplay[field], field), 1230);
      assert.deepEqual(await page.evaluate(() => window.displayRequests), [
        { patch: { [field]: 1200 } }, { patch: { [field]: 1230 } },
      ]);
    });
  }
});

test('gift snapshots refill a focused unedited number on blur without submitting its old value', async t => {
  const page = await openSettings(t);
  const threshold = page.locator('#giftTier1');
  await threshold.focus();
  await page.evaluate(() => {
    window.savedDisplay.thresholds[0] = 12000;
    window.savedDisplay.scrollSpeed = 34;
    window.dispatchEvent(new CustomEvent('app:settings-state', {
      detail: { giftDisplayConfig: JSON.stringify(window.savedDisplay) },
    }));
  });
  assert.equal(await threshold.inputValue(), '100');
  assert.equal(await page.locator('#giftTierEnd0').inputValue(), '120');
  assert.equal(await page.locator('#giftFeedSpeed').inputValue(), '34');
  await threshold.press('Enter');
  await page.clock.runFor(650);
  assert.equal(await page.evaluate(() => window.displayRequests.length), 0);
  await page.locator('#giftFeedRows').fill('5');
  assert.equal(await threshold.inputValue(), '120');
  await saveEdits(page);
  await page.waitForFunction(() => window.displaySaves.length === 1);
  assert.deepEqual(await page.evaluate(() => window.displayRequests[0]), { patch: { visibleRows: 5 } });
  assert.equal(await page.evaluate(() => window.savedDisplay.thresholds[0]), 12000);
});

test('gift concurrency preserves another threshold when saving the local threshold edit', async t => {
  const page = await openSettings(t);
  await page.locator('#giftTier1').fill('125.25');
  await page.evaluate(() => {
    window.savedDisplay.thresholds[1] = 60000;
    window.dispatchEvent(new CustomEvent('app:settings-state', {
      detail: { giftDisplayConfig: JSON.stringify(window.savedDisplay) },
    }));
  });
  await saveEdits(page);
  await page.waitForFunction(() => window.displaySaves.length === 1);
  assert.equal(await page.evaluate(() => window.savedDisplay.thresholds[0]), 12525);
  assert.equal(await page.evaluate(() => window.savedDisplay.thresholds[1]), 60000);
  assert.deepEqual(await page.evaluate(() => window.displayRequests[0]), { patch: { threshold1: 12525 } });
});

test('gift concurrency preserves a canvas update that lands before a pending desktop write', async t => {
  const page = await openSettings(t);
  await page.evaluate(() => {
    const fetchConfig = window.fetch;
    window.fetch = (url, options = {}) => {
      if (options.method !== 'POST') return fetchConfig(url, options);
      const body = JSON.parse(options.body);
      window.displayRequests.push(body);
      return new Promise(resolve => {
        window.applyPendingDisplay = async () => {
          window.savedDisplay = await window.applyDisplayPatch(window.savedDisplay, body.patch);
          window.displaySaves.push(structuredClone(window.savedDisplay));
          window.dispatchEvent(new CustomEvent('app:settings-state', {
            detail: { giftDisplayConfig: JSON.stringify(window.savedDisplay) },
          }));
          resolve({ ok: true, json: async () => ({ ok: true, data: structuredClone(window.savedDisplay) }) });
        };
      });
    };
  });
  await page.locator('#giftFeedRows').fill('5');
  await saveEdits(page);
  await page.waitForFunction(() => typeof window.applyPendingDisplay === 'function');
  await page.evaluate(() => {
    window.savedDisplay.scrollSpeed = 40;
    window.dispatchEvent(new CustomEvent('app:settings-state', {
      detail: { giftDisplayConfig: JSON.stringify(window.savedDisplay) },
    }));
  });
  assert.equal(await page.locator('#giftFeedSpeed').inputValue(), '40');
  await page.evaluate(() => window.applyPendingDisplay());
  await page.clock.runFor(650);
  assert.equal(await page.evaluate(() => window.savedDisplay.visibleRows), 5);
  assert.equal(await page.evaluate(() => window.savedDisplay.scrollSpeed), 40);
});

test('gift display retains its patch after an incomplete or mismatched receipt and retries against current settings', async t => {
  for (const receipt of ['missing', 'mismatched']) {
    await t.test(receipt, async t => {
      const page = await openSettings(t);
      await page.evaluate(receipt => {
        const fetchConfig = window.fetch;
        window.fetch = (url, options = {}) => {
          if (options.method !== 'POST' || window.displayRequests.length) return fetchConfig(url, options);
          window.displayRequests.push(JSON.parse(options.body));
          return Promise.resolve({ ok: true, json: async () => ({ ok: true,
            ...(receipt === 'mismatched' ? { data: structuredClone(window.savedDisplay) } : {}) }) });
        };
      }, receipt);
      await page.locator('#giftTier1').fill('125.25');
      await saveEdits(page);
      await page.locator('#giftDisplayCancel').waitFor();
      assert.equal(await page.locator('#giftTier1').inputValue(), '125.25');
      assert.equal(await page.evaluate(() => window.displaySaves.length), 0);
      await page.evaluate(() => {
        window.savedDisplay.scrollSpeed = 40;
        window.savedDisplay.thresholds[1] = 60000;
        window.dispatchEvent(new CustomEvent('app:settings-state', {
          detail: { giftDisplayConfig: JSON.stringify(window.savedDisplay) },
        }));
      });
      await saveEdits(page);
      await page.waitForFunction(() => window.displaySaves.length === 1);
      assert.equal(await page.evaluate(() => window.savedDisplay.thresholds[0]), 12525);
      assert.equal(await page.evaluate(() => window.savedDisplay.thresholds[1]), 60000);
      assert.equal(await page.evaluate(() => window.savedDisplay.scrollSpeed), 40);
      assert.deepEqual(await page.evaluate(() => window.displayRequests), [
        { patch: { threshold1: 12525 } }, { patch: { threshold1: 12525 } },
      ]);
    });
  }
});

test('gift feed speed auto-saves and failed edits can be discarded without replacing saved values', async (t) => {
  const page = await openSettings(t);
  const speed = page.locator('#giftFeedSpeed');
  await speed.fill('50');
  await saveEdits(page);
  await page.waitForFunction(() => window.displaySaves.length === 1);
  await page.waitForFunction(() => !document.getElementById('giftDisplayFields').disabled);
  assert.equal(await page.evaluate(() => window.savedDisplay.scrollSpeed), 50);
  await page.evaluate(() => { window.failDisplaySave = true; });
  await speed.fill('20');
  await saveEdits(page);
  await page.locator('#giftDisplayCancel').waitFor();
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
  await saveEdits(page);
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
  await page.evaluate(() => { window.failDisplaySave = true; });
  await saveEdits(page);
  await page.locator('#giftDisplayCancel').waitFor();
  await page.locator('#giftDisplayCancel').click();
  await page.evaluate(() => { window.failDisplaySave = false; });
  assert.equal(await texture.inputValue(), 'lace');
  assert.equal(await sheen.isChecked(), true);
  assert.equal(await page.locator('#giftFeedRows').inputValue(), '5');
  await page.evaluate(() => {
    const fetchConfig = window.fetch;
    window.fetch = async (url, options = {}) => {
      if (options.method !== 'POST') return fetchConfig(url, options);
      const body = JSON.parse(options.body);
      window.displayRequests.push(body);
      const submitted = await window.applyDisplayPatch(window.savedDisplay, body.patch);
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
  await saveEdits(page);
  await page.waitForFunction(() => typeof window.finishDisplaySave === 'function');
  await page.evaluate(() => window.finishDisplaySave());
  await page.locator('#giftFeedSpeed').blur();
  await page.waitForFunction(() => document.getElementById('giftFeedSpeed').value === '40');
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
  await saveEdits(page);
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
  await saveEdits(page);
  await page.waitForFunction(() => window.displaySaves.length === 1);
  assert.deepEqual(await page.evaluate(() => window.displaySaves[0].thresholds), [12525, 60050, 120050]);
});

test('gift display reads only its settings and keeps the draft across navigation', async (t) => {
  const page = await openSettings(t, { tabs: true });
  await page.locator('#giftFeedRows').fill('5');
  await page.getByRole('tab', { name: '全屏礼物感谢', exact: true }).click();
  await page.getByRole('tab', { name: '全屏礼物感谢', exact: true }).press('ArrowRight');
  assert.equal(await page.locator('#giftFeedRows').inputValue(), '5');
  assert.deepEqual(await page.evaluate(() => window.displayReads), ['/api/gifts/display-settings']);
  await saveEdits(page);
  await page.waitForFunction(() => window.displaySaves.length === 1);
  assert.equal(await page.evaluate(() => window.savedDisplay.visibleRows), 5);
});
