'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');
const { readCssBundle } = require('../helpers/css-bundle');
const { readAdminFragmentHtml } = require('../helpers/admin-html');

const fixture = createUiFixture();
const html = readAdminFragmentHtml('pages/admin/toolbox/gift.html');
const historyHtml = fs.readFileSync(path.resolve('public/pages/admin/gifts/history.html'), 'utf8');

async function openSettings(t) {
  const page = await fixture(t, 'gift-display');
  await page.setContent(html);
  await page.evaluate(async () => {
    document.getElementById('otherGiftFeature').hidden = false;
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
    const { initGiftAssistant } = await import('/js/admin/gift-assistant.js');
    initGiftAssistant();
    document.getElementById('giftAssistantDisplayTab').click();
  });
  await page.waitForFunction(() => !document.getElementById('giftDisplayFields').disabled);
  return page;
}

test('style preview holds each palette color, animates between them and loops', async (t) => {
  const page = await openSettings(t);
  for (const file of ['public/css/shared/gift-banner.css', 'public/css/admin/gift-display.css']) {
    await page.addStyleTag({ content: readCssBundle(file) });
  }
  await page.locator('#giftStylePreview').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.getElementById('giftStylePreview').classList.contains('is-playing'));
  const result = await page.evaluate(async () => {
    const { GIFT_PALETTE } = await import('/js/shared/gift-banner.js');
    const preview = document.getElementById('giftStylePreview');
    const banners = [...preview.children];
    const animations = preview.getAnimations({ subtree: true });
    animations.forEach((animation) => animation.pause());
    const sample = (time) => {
      animations.forEach((animation) => {
        animation.currentTime = time;
      });
      return banners.map((banner) => Number(getComputedStyle(banner).opacity));
    };
    const colors = banners.map((banner) =>
      ['--gift-start', '--gift-end'].map((name) => banner.style.getPropertyValue(name)),
    );
    const cycle = animations.find((animation) => animation.effect.target === banners[0]);
    const duration = Number(cycle.effect.getTiming().duration);
    const keyframes = cycle.effect.getKeyframes();
    const holdEnd = duration * keyframes.find((frame) => frame.offset > 0 && Number(frame.opacity) === 1).offset;
    const transitionEnd = duration * keyframes.find((frame) => Number(frame.opacity) === 0).offset;
    const turn = duration / banners.length;
    const heldColors = Array.from({ length: banners.length + 1 }, (_, index) => [
      index * turn,
      index * turn + holdEnd / 2,
    ]).flat().map((time) => sample(time).flatMap((opacity, index) => (opacity === 1 ? [index] : [])));
    const transition = sample((holdEnd + transitionEnd) / 2);
    return { colors, palette: GIFT_PALETTE, heldColors, transition };
  });
  assert.deepEqual(result.colors, result.palette);
  assert.deepEqual(result.heldColors, Array.from({ length: result.palette.length + 1 }, (_, index) =>
    [[index % result.palette.length], [index % result.palette.length]],
  ).flat());
  assert.ok(result.transition[0] > 0 && result.transition[0] < 1);
  assert.ok(result.transition[1] > 0 && result.transition[1] < 1);
  assert.ok(result.transition.slice(2).every((opacity) => opacity === 0));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page.locator('#giftStylePreview .gift-banner').first().evaluate((banner) => getComputedStyle(banner).transform),
    'matrix(1, 0, 0, 1, 0, 0)',
  );
  await page.getByRole('tab', { name: '礼物边框', exact: true }).click();
  await page.waitForFunction(() => !document.getElementById('giftStylePreview').classList.contains('is-playing'));
  await page.getByRole('tab', { name: '滚动礼物', exact: true }).click();
  await page.locator('#giftStylePreview').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.getElementById('giftStylePreview').classList.contains('is-playing'));
  assert.equal(await page.locator('#giftStylePreview .gift-banner').count(), result.palette.length);
});

test('gift feed settings save speed and remove the pause and low-power options', async (t) => {
  const page = await openSettings(t);
  const speed = page.getByRole('spinbutton', { name: '滚动速率（1–50）', exact: true });
  const cancel = page.getByRole('button', { name: '取消修改', exact: true, includeHidden: true });
  assert.equal(await speed.inputValue(), '26');
  assert.equal(await cancel.isHidden(), true);
  assert.equal(await page.locator('#giftFeedSpeedHint').count(), 0);
  assert.equal(await page.locator('#giftFeedPaused, #giftFeedLowPower, #giftFeedInterval').count(), 0);
  for (const invalid of ['0', '51', '1.5']) {
    await speed.fill(invalid);
    assert.equal(await speed.evaluate((input) => input.checkValidity()), false);
  }
  await speed.fill('50');
  await page.getByRole('button', { name: '保存滚动与样式设置', exact: true }).click();
  await page.waitForFunction(() => window.displaySaves.length === 1);
  await page.waitForFunction(() => !document.getElementById('giftDisplayFields').disabled);
  assert.equal(await cancel.isHidden(), true);
  assert.deepEqual(await page.evaluate(() => window.savedDisplay), {
    palette: 'bilibili-four',
    thresholds: [10000, 50000, 100000],
    visibleRows: 3,
    scrollSpeed: 50,
    minGiftAmountCents: 0,
  });
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  assert.equal(await speed.inputValue(), '12');
  assert.equal(await cancel.isVisible(), true);
  await cancel.click();
  assert.equal(await speed.inputValue(), '50');
  assert.equal(await cancel.isHidden(), true);
  assert.equal(await page.evaluate(() => window.messages.at(-1)), '已恢复上次保存的设置');
});

test('cancel appears for unsaved fields and hides when their saved values are restored', async (t) => {
  const page = await openSettings(t);
  const cancel = page.locator('#giftDisplayCancel');
  for (const [id, changed] of [
    ['giftTierEnd0', '125.25'],
    ['giftTier2', '600.5'],
    ['giftTierEnd2', '1200.5'],
    ['giftFeedRows', '5'],
    ['giftFeedSpeed', '30'],
    ['giftFeedMinAmount', '1.1'],
  ]) {
    const input = page.locator(`#${id}`);
    const saved = await input.inputValue();
    await input.fill(changed);
    assert.equal(await cancel.isVisible(), true, id);
    await input.fill(`${saved}.0`);
    assert.equal(await cancel.isHidden(), true, id);
  }
  await page.locator('#giftFeedMinAmount').fill('');
  assert.equal(await cancel.isVisible(), true);
  await cancel.click();
  assert.equal(await page.locator('#giftFeedMinAmount').inputValue(), '0');
  assert.equal(await cancel.isHidden(), true);
  assert.deepEqual(await page.evaluate(() => window.displaySaves), []);
});

test('feed minimum accepts one decimal place, saves cents and restores saved or default amounts', async (t) => {
  const page = await openSettings(t);
  const amount = page.getByRole('spinbutton', { name: '最小礼物金额（元）', exact: true });
  assert.equal(await amount.inputValue(), '0');
  for (const invalid of ['', '-1', '0.01', '10.15']) {
    await amount.fill(invalid);
    assert.equal(await amount.evaluate((input) => input.checkValidity()), false);
  }
  for (const valid of ['0', '10', '10.5']) {
    await amount.fill(valid);
    assert.equal(await amount.evaluate((input) => input.checkValidity()), true);
  }
  await amount.fill('1.1');
  await page.getByRole('button', { name: '保存滚动与样式设置', exact: true }).click();
  await page.waitForFunction(() => window.displaySaves.length === 1);
  assert.equal(await page.evaluate(() => window.savedDisplay.minGiftAmountCents), 110);
  assert.equal(await amount.inputValue(), '1.1');
  await amount.fill('10.5');
  await page.getByRole('button', { name: '取消修改', exact: true }).click();
  assert.equal(await amount.inputValue(), '1.1');
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  assert.equal(await amount.inputValue(), '0');
  assert.equal(await page.evaluate(() => window.savedDisplay.minGiftAmountCents), 110);
  await page.getByRole('button', { name: '保存滚动与样式设置', exact: true }).click();
  await page.waitForFunction(() => window.displaySaves.length === 2);
  assert.equal(await page.evaluate(() => window.savedDisplay.minGiftAmountCents), 0);
});

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
  assert.deepEqual(
    await page.evaluate(async () => {
      const { giftTier } = await import('/js/shared/gift-banner.js');
      return [125.24, 125.25, 600.49, 600.5, 1200.49, 1200.5].map((unitPrice) =>
        giftTier({ unitPrice, num: 1 }, window.savedDisplay.thresholds),
      );
    }),
    [0, 1, 1, 2, 2, 3],
  );
});

test('defaults reset both range endpoints and cancelling discards the draft', async (t) => {
  const page = await openSettings(t);
  await page.locator('#giftTierEnd0').fill('25');
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  assert.deepEqual(
    await page.locator('[data-gift-boundary]').evaluateAll((inputs) => inputs.map((input) => input.value)),
    ['30', '30', '100', '100', '1000', '1000'],
  );
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

test('gift assistant keeps frame and display settings while export settings live in history', async (t) => {
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
  assert.doesNotMatch(historyHtml, /giftDisplaySettings|giftExportRemember/);
  assert.doesNotMatch(html, /giftAssistantExportTab|giftExportSettings/);
  for (const id of ['giftExportMode', 'giftExportBackground', 'giftExportChoose', 'giftExportDefault']) {
    assert.ok(historyHtml.includes(`id="${id}"`));
  }
  assert.match(historyHtml, /giftHistoryExport/);
  assert.match(historyHtml, /giftExportPreview/);
  assert.match(historyHtml, /giftExportSave/);
});
