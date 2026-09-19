'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createUiFixture } = require('./helpers/ui-edit-state-fixture');

const fixture = createUiFixture();
const html = fs.readFileSync(path.resolve('public/pages/admin/toolbox/gift.html'), 'utf8');
const historyHtml = fs.readFileSync(path.resolve('public/pages/admin/gifts/history.html'), 'utf8');

async function openSettings(t) {
  const page = await fixture(t, 'gift-display');
  await page.setContent(html);
  await page.evaluate(async () => {
    document.getElementById('otherGiftFeature').hidden = false;
    window.savedDisplay = {
      palette: 'bilibili-four', thresholds: [10000, 50000, 100000],
      visibleRows: 3, intervalSeconds: 4, paused: false, lowPower: false,
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
    const { initGiftAssistant } = await import('/js/admin/gift-assistant.js');
    initGiftAssistant();
    document.getElementById('giftAssistantDisplayTab').click();
  });
  await page.waitForFunction(() => !document.getElementById('giftDisplayFields').disabled);
  return page;
}

test('gift range endpoints synchronize both ways and save exact cent boundaries', async (t) => {
  const page = await openSettings(t);
  assert.equal(await page.locator('.gift-tier-inputs input').count(), 8);
  await page.locator('#giftTierEnd0').fill('125.25');
  assert.equal(await page.locator('#giftTier1').inputValue(), '125.25');
  await page.locator('#giftTier2').fill('600.5');
  assert.equal(await page.locator('#giftTierEnd1').inputValue(), '600.5');
  await page.locator('#giftTierEnd2').fill('1200.5');
  assert.equal(await page.locator('#giftTier3').inputValue(), '1200.5');
  await page.getByRole('button', { name: '保存滚动与样式设置', exact: true }).click();
  await page.waitForFunction(() => window.displaySaves.length === 1);
  assert.deepEqual(await page.evaluate(() => window.displaySaves[0].thresholds), [12525, 60050, 120050]);
  assert.equal(await page.locator('#giftDisplaySettings').isVisible(), true);
  assert.deepEqual(await page.evaluate(async () => {
    const { giftTier } = await import('/js/shared/gift-banner.js');
    return [125.24, 125.25, 600.49, 600.5, 1200.49, 1200.5].map((unitPrice) =>
      giftTier({ unitPrice, num: 1 }, window.savedDisplay.thresholds));
  }), [0, 1, 1, 2, 2, 3]);
});

test('defaults reset both range endpoints and cancelling discards the draft', async (t) => {
  const page = await openSettings(t);
  await page.locator('#giftTierEnd0').fill('25');
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  assert.deepEqual(await page.locator('[data-gift-boundary]').evaluateAll((inputs) =>
    inputs.map((input) => input.value)), ['100', '100', '500', '500', '1000', '1000']);
  await page.locator('#giftTierEnd0').fill('');
  assert.equal(await page.locator('#giftTier1').inputValue(), '');
  assert.equal(await page.locator('#giftDisplayForm').evaluate((form) => form.checkValidity()), false);
  await page.locator('#giftTier1').fill('150');
  await page.getByRole('button', { name: '取消修改', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.displaySaves), []);
  await page.getByRole('tab', { name: '礼物边框', exact: true }).click();
  await page.getByRole('tab', { name: '滚动礼物', exact: true }).click();
  assert.equal(await page.locator('#giftTier1').inputValue(), '100');
  assert.equal(await page.locator('#giftTierEnd0').inputValue(), '100');
});

test('gift assistant separates frame, display and export settings from gift history', async (t) => {
  const page = await openSettings(t);
  await page.locator('#giftFeedRows').fill('5');
  await page.getByRole('tab', { name: '礼物边框', exact: true }).click();
  assert.equal(await page.locator('#giftFramePanel').isVisible(), true);
  assert.equal(await page.locator('#giftDisplaySettings').isHidden(), true);
  await page.getByRole('tab', { name: '礼物边框', exact: true }).press('ArrowRight');
  assert.equal(await page.locator('#giftFeedRows').inputValue(), '5');
  assert.equal(await page.getByRole('tab', { name: '滚动礼物', exact: true }).getAttribute('aria-selected'), 'true');
  await page.getByRole('button', { name: '保存滚动与样式设置', exact: true }).click();
  await page.waitForFunction(() => window.displaySaves.length === 1);
  assert.equal(await page.evaluate(() => window.savedDisplay.visibleRows), 5);
  assert.doesNotMatch(historyHtml, /giftDisplaySettings|giftExportMode|giftExportBackground|giftExportChoose|giftExportRemember/);
  assert.match(historyHtml, /giftHistoryExport/);
  assert.match(historyHtml, /giftExportPreview/);
  assert.match(historyHtml, /giftExportSave/);
});

test('export defaults can be edited without selecting gifts and remain available after returning', async (t) => {
  const page = await openSettings(t);
  await page.evaluate(() => {
    window.exportCalls = [];
    const settings = { mode: 'combined', background: 'transparent', directory: 'Pictures/LIRA', custom: false };
    window.giftExport = { async settings(options) {
      window.exportCalls.push(options || null);
      if (options?.mode) settings.mode = options.mode;
      if (options?.background) settings.background = options.background;
      if (options?.directoryAction) settings.directory = options.directoryAction === 'choose' ? 'Chosen/Gifts' : 'Pictures/LIRA';
      return { ok: true, data: structuredClone(settings) };
    } };
  });
  await page.getByRole('tab', { name: '图片导出', exact: true }).click();
  await page.locator('#giftExportMode').selectOption('separate');
  await page.locator('#giftExportBackground').selectOption('white');
  await page.getByRole('button', { name: '选择文件夹', exact: true }).click();
  assert.equal(await page.locator('#giftExportSettingsDirectory').textContent(), 'Chosen/Gifts');
  await page.getByRole('tab', { name: '滚动礼物', exact: true }).click();
  await page.getByRole('tab', { name: '图片导出', exact: true }).click();
  assert.equal(await page.locator('#giftExportMode').inputValue(), 'separate');
  assert.equal(await page.locator('#giftExportBackground').inputValue(), 'white');
  await page.getByRole('button', { name: '系统默认', exact: true }).click();
  assert.equal(await page.locator('#giftExportSettingsDirectory').textContent(), 'Pictures/LIRA');
  assert.deepEqual(await page.evaluate(() => window.exportCalls), [null, { mode: 'separate' }, { background: 'white' }, { directoryAction: 'choose' }, { directoryAction: 'default' }]);
});

test('gift banners fit long names and inset the avatar inside the rounded color bar', async (t) => {
  const page = await fixture(t, 'gift-display');
  await page.setContent('<div id="giftStylePreview" class="gift-banner-stage"></div>');
  await page.addStyleTag({ content: fs.readFileSync(path.resolve('public/css/shared/gift-banner.css'), 'utf8') });
  const layout = await page.evaluate(async () => {
    const { createGiftBanner, fitGiftBannerNames } = await import('/js/shared/gift-banner.js');
    const preview = document.getElementById('giftStylePreview');
    preview.replaceChildren(createGiftBanner({
      eventId: 'long-name',
      gift: { giftId: 'sample', giftName: '长礼物名测试'.repeat(3), userName: '长昵称测试'.repeat(5), unitPrice: 2, num: 1 },
    }, { thresholds: [10000, 50000, 100000] }));
    await document.fonts.ready;
    fitGiftBannerNames(preview);
    const banner = document.querySelector('#giftStylePreview .gift-banner');
    const bounds = banner.getBoundingClientRect();
    const text = banner.querySelector('.gift-banner-text').getBoundingClientRect();
    const artwork = banner.querySelector('.gift-banner-artwork').getBoundingClientRect();
    const avatar = banner.querySelector('.gift-banner-avatar').getBoundingClientRect();
    const bar = banner.querySelector('.gift-banner-background').getBoundingClientRect();
    return {
      width: bounds.width, height: bounds.height,
      avatarWidth: avatar.width,
      avatarInsets: [avatar.left - bar.left, avatar.top - bar.top, bar.bottom - avatar.bottom],
      nameFits: banner.querySelector('.gift-banner-name').scrollWidth <= banner.querySelector('.gift-banner-name').clientWidth,
      nameShrinks: parseFloat(getComputedStyle(banner.querySelector('.gift-banner-name')).fontSize) < 18,
      giftFits: banner.querySelector('.gift-banner-gift').scrollWidth <= banner.querySelector('.gift-banner-gift').clientWidth,
      textClearsArtwork: text.right <= artwork.left,
      quantityFits: banner.querySelector('.gift-banner-count').getBoundingClientRect().right <= bounds.right,
    };
  });
  assert.deepEqual(layout, {
    width: 504, height: 72, avatarWidth: 52, avatarInsets: [6, 6, 6],
    nameFits: true, nameShrinks: true, giftFits: true, textClearsArtwork: true, quantityFits: true,
  });
});

test('gift names fit their full text at normal and PNG scale while short names keep their size', async (t) => {
  const page = await fixture(t, 'gift-display');
  await page.setContent('<div id="stage" class="gift-banner-stage"></div>');
  await page.addStyleTag({ content: fs.readFileSync(path.resolve('public/css/shared/gift-banner.css'), 'utf8') });
  const result = await page.evaluate(async () => {
    const { createGiftBanner, fitGiftBannerNames } = await import('/js/shared/gift-banner.js');
    await import('/js/overlays/gift-export.js');
    const names = ['短昵称', '中'.repeat(15), '很长的中文昵称'.repeat(6), 'WideW_1234567890'.repeat(4), '观众🎉🚀_Viewer'.repeat(5)];
    const items = names.map((userName, index) => ({
      eventId: String(index), gift: { giftId: 'sample', giftName: '礼物', userName, unitPrice: 2, num: 1 },
    }));
    const config = { thresholds: [10000, 50000, 100000] };
    const stage = document.getElementById('stage');
    const measure = () => [...stage.querySelectorAll('.gift-banner-name')].map((name) => {
      const range = document.createRange();
      range.selectNodeContents(name);
      return { text: name.textContent, fontSize: parseFloat(getComputedStyle(name).fontSize),
        fits: range.getBoundingClientRect().width <= name.getBoundingClientRect().width };
    });
    stage.replaceChildren(...items.map((item) => createGiftBanner(item, config)));
    fitGiftBannerNames(stage);
    const normal = measure();
    stage.style.transform = 'scale(2)';
    stage.style.transformOrigin = 'top left';
    const output = await window.renderGiftExport({ items, config, catalog: [], background: 'transparent' });
    return { names, normal, scaled: measure(), output };
  });
  assert.deepEqual(result.normal, result.scaled);
  assert.deepEqual(result.normal.map((name) => name.text), result.names);
  assert.ok(result.normal.every((name) => name.fits));
  assert.equal(result.normal[0].fontSize, 18);
  assert.equal(result.normal[1].fontSize, 18);
  assert.ok(result.normal.slice(2).every((name) => name.fontSize > 0 && name.fontSize < 18));
  assert.equal(result.output.width, 1008);
});

test('long gift counts expand PNG and OBS canvases without moving artwork or squeezing text', async (t) => {
  const page = await fixture(t, 'gift-display');
  await page.setContent('<div id="giftFeedViewport"><div id="stage" class="gift-banner-stage"></div></div>');
  await page.addStyleTag({ content: fs.readFileSync(path.resolve('public/css/shared/gift-banner.css'), 'utf8') });
  await page.addStyleTag({ content: fs.readFileSync(path.resolve('public/css/overlays/gift-feed.css'), 'utf8') });
  const result = await page.evaluate(async () => {
    await import('/js/overlays/gift-export.js');
    const stage = document.getElementById('stage');
    stage.style.transform = 'scale(2)';
    stage.style.transformOrigin = 'top left';
    const items = [1, 1234, 12345678, Number.MAX_SAFE_INTEGER].map((num) => ({
      eventId: String(num), gift: { giftId: 'sample', giftName: '测试礼物', userName: '测试观众', unitPrice: 2, num },
    }));
    const payload = { config: { thresholds: [10000, 50000, 100000] }, catalog: [], background: 'transparent' };
    const singles = [];
    for (const item of items) {
      singles.push(await window.renderGiftExport({ ...payload, items: [item] }));
    }
    const combined = await window.renderGiftExport({ ...payload, items });
    stage.style.transform = 'none';
    return {
      singles, combined,
      viewportWidth: document.getElementById('giftFeedViewport').getBoundingClientRect().width,
      rows: [...stage.children].map((row) => {
        const bounds = row.getBoundingClientRect();
        const text = row.querySelector('.gift-banner-text').getBoundingClientRect();
        const artwork = row.querySelector('.gift-banner-artwork').getBoundingClientRect();
        const count = row.querySelector('.gift-banner-count').getBoundingClientRect();
        return {
          width: bounds.width, artworkLeft: artwork.left - bounds.left, textWidth: text.width,
          barWidth: row.querySelector('.gift-banner-background').getBoundingClientRect().width,
          countLeft: count.left - bounds.left, countSize: getComputedStyle(row.querySelector('.gift-banner-count')).fontSize,
          rightPadding: bounds.right - count.right, artworkClear: artwork.right <= count.left,
        };
      }),
    };
  });
  assert.deepEqual(result.singles[0], { width: 1008, height: 144 });
  assert.equal(result.rows[0].width, 504);
  for (let index = 0; index < result.rows.length; index += 1) {
    const row = result.rows[index];
    assert.equal(result.singles[index].width, Math.ceil(row.width * 2));
    assert.equal(row.artworkLeft, result.rows[0].artworkLeft);
    assert.equal(row.textWidth, result.rows[0].textWidth);
    assert.equal(row.barWidth, result.rows[0].barWidth);
    assert.equal(row.countLeft, result.rows[0].countLeft);
    assert.equal(row.countSize, '40px');
    assert.ok(row.rightPadding >= 20);
    assert.ok(row.artworkClear);
    if (index) assert.ok(row.width > result.rows[index - 1].width);
  }
  assert.equal(result.combined.width, result.singles.at(-1).width);
  assert.equal(result.combined.height, 624);
  assert.equal(result.viewportWidth, result.rows.at(-1).width);
  assert.ok(result.viewportWidth <= 900);
});
