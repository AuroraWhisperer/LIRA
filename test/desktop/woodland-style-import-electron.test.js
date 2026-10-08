'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchElectron } = require('../helpers/shared-electron');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');
const { createWoodlandGiftZip } = require('../../scripts/package-woodland-gift-frame');

test('woodland ZIP imports through desktop styles and retains native layout, settings and canvas geometry', { timeout: 90000 }, async t => {
  const root = path.resolve(__dirname, '../..');
  const directory = createScratchDirectory('woodland-import-electron-');
  const archive = path.join(directory, '林间花信-1.0.0.zip');
  fs.writeFileSync(archive, createWoodlandGiftZip());
  let app; let browser;
  t.after(async () => { await browser?.close(); await app?.close(); removeScratchDirectory(directory); });
  app = await launchElectron({ cwd: root, args: ['test/fixtures/danmaku-canvas-editor.cjs', directory], timeout: 20000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.locator('#danmakuStyleChip').filter({ hasText: '已应用' }).waitFor();
  await page.evaluate(async markup => {
    const source = new DOMParser().parseFromString(markup, 'text/html');
    const feature = source.getElementById('otherGiftFeature');
    feature.hidden = false; feature.style.display = 'block'; document.body.append(feature);
    await import('/js/admin/contextual-help.js');
    const { initGiftFrame, renderGiftFrame } = await import('/js/admin/gift-frame.js');
    initGiftFrame(); renderGiftFrame({ giftFrameEnabled: 'false', giftFrameThresholdRmb: '20' });
    const { initComponentStyleLibraries } = await import('/js/admin/component-style-client.js');
    initComponentStyleLibraries();
  }, fs.readFileSync(path.join(root, 'public/pages/admin/toolbox/gift.html'), 'utf8'));
  const panel = page.locator('#giftFramePanel');
  await page.locator('#giftFramePreviewBtn').click();
  await page.locator('#giftFrameSaveState').filter({ hasText: '导入林间花信' }).waitFor();
  assert.equal((await app.evaluate(() => global.canvasTest.externalUrls)).length, 0);
  async function importArchive() {
    await panel.getByRole('button', { name: '＋ 添加样式', exact: true }).click();
    await app.evaluate(({ dialog }, selected) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = async () => {
        dialog.showOpenDialog = original;
        return { canceled: false, filePaths: [selected] };
      };
    }, archive);
    await page.getByRole('button', { name: '选择文件', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: '确认添加样式', exact: true });
    assert.match(await confirm.innerText(), /版本 1\.0\.0 · 1 个样式/);
    await confirm.getByRole('button', { name: '添加样式', exact: true }).click();
    await confirm.waitFor({ state: 'detached' });
    await panel.getByRole('button', { name: '添加到画布：林间花信', exact: true }).waitFor();
  }
  await importArchive();
  assert.equal(await page.locator('#giftFrameThresholdRmb').inputValue(), '20');
  assert.equal(await page.locator('#giftFrameEnabled').isChecked(), false);
  assert.equal(await page.locator('#giftFrameSaveState').textContent(), '');
  await page.locator('#giftFrameThresholdRmb').fill('35');
  await page.locator('label').filter({ has: page.locator('#giftFrameEnabled') }).click();
  await page.locator('#giftFrameSaveBtn').click();
  await page.waitForFunction(() => document.getElementById('giftFrameSaveState').textContent.includes('已保存'));
  await importArchive();
  assert.equal(await page.locator('#giftFrameThresholdRmb').inputValue(), '35');
  assert.equal(await page.locator('#giftFrameEnabled').isChecked(), true);
  assert.deepEqual(await app.evaluate(() => [global.canvasTest.openingSettings.giftFrameThresholdRmb,
    global.canvasTest.openingSettings.giftFrameEnabled]), ['35', 'true']);
  assert.equal(await panel.locator('[data-custom-style-id]').count(), 1);
  await panel.getByRole('button', { name: '添加到画布：林间花信', exact: true }).click();
  await page.waitForFunction(async () => {
    const { prepareComponentPreviews } = await import('/js/admin/component-preview-registry.js');
    return (await prepareComponentPreviews()).find(entry => entry.id === 'canvas')?.controller.getState().draft.document.items.length === 1;
  });
  let canvasUrl;
  await assert.doesNotReject(async () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      canvasUrl = (await app.evaluate(() => global.canvasTest.externalUrls)).at(-1);
      if (canvasUrl) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('The desktop did not open the canvas.');
  });
  assert.equal((await fetch(canvasUrl)).status, 200);
  browser = await chromium.launch({ headless: true });
  const canvas = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  canvas.setDefaultTimeout(10000); canvas.on('pageerror', error => errors.push(error.message));
  await canvas.goto(canvasUrl);
  const frame = canvas.frameLocator('.scene-editor-item[data-component="gift-frame"] iframe');
  await frame.locator('#giftFrame.is-playing').waitFor({ state: 'visible' });
  const native = await frame.locator('#giftFrame').evaluate(root => {
    const video = root.querySelector('video');
    const style = node => getComputedStyle(node);
    return { logical: [style(root).width, style(root).height], movie: [video.videoWidth, video.videoHeight, video.duration],
      imported: new URL(video.currentSrc).pathname.startsWith('/component-media/'),
      caption: [style(root.querySelector('.gift-info')).left, style(root.querySelector('.gift-info')).top],
      avatar: style(root.querySelector('.gift-info-avatar')).width, font: style(root.querySelector('.gift-info-gift')).fontSize };
  });
  assert.deepEqual(native, { logical: ['1920px', '1080px'], movie: [2560, 1440, 8], imported: true,
    caption: ['676px', '864px'], avatar: '96px', font: '38px' });
  assert.equal(await canvas.getByRole('spinbutton', { name: '宽度', exact: true }).inputValue(), '1920');
  assert.equal(await canvas.getByRole('spinbutton', { name: '高度', exact: true }).inputValue(), '1080');
  await canvas.getByRole('spinbutton', { name: '宽度', exact: true }).fill('960');
  await canvas.getByRole('spinbutton', { name: '宽度', exact: true }).press('Tab');
  await canvas.getByRole('spinbutton', { name: '高度', exact: true }).fill('540');
  await canvas.getByRole('spinbutton', { name: '高度', exact: true }).press('Tab');
  await canvas.getByRole('button', { name: '保存并应用', exact: true }).click();
  await canvas.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = await app.evaluate(() => global.canvasTest.scene().document.items);
  assert.equal(saved.length, 1);
  assert.deepEqual([saved[0].width, saved[0].height], [960, 540]);
  assert.equal(saved[0].appearance.config.resourceStyle.preset, 'woodland-gift-frame');
  await page.locator('#giftFramePreviewGift').fill('导入后礼物');
  await page.locator('#giftFramePreviewNum').fill('9');
  await page.locator('#giftFramePreviewBtn').click();
  await frame.locator('#giftInfoName').filter({ hasText: '导入后礼物' }).waitFor({ state: 'visible' });
  assert.equal(await frame.locator('#giftInfoNum').textContent(), '×9');
  assert.equal(await canvas.locator('.scene-editor-item[data-component="gift-frame"]').count(), 1);
  assert.equal(await canvas.getByRole('spinbutton', { name: '宽度', exact: true }).inputValue(), '960');
  await canvas.reload();
  await frame.locator('#giftFrame.is-playing').waitFor({ state: 'visible' });
  assert.equal(await canvas.getByRole('spinbutton', { name: '高度', exact: true }).inputValue(), '540');
  assert.deepEqual(errors, []);
});
