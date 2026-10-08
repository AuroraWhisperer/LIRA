'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchElectron } = require('../helpers/shared-electron');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');
const { installResourceStyles, mountResourceStylePage } = require('../helpers/resource-style-fixture');

test('desktop and canvas share local settings and imported resources across instances and reopening', { timeout: 90000 }, async t => {
  const root = path.resolve(__dirname, '../..');
  const directory = createScratchDirectory('shared-canvas-electron-');
  let app;
  let browser;
  t.after(async () => { await browser?.close(); await app?.close(); removeScratchDirectory(directory); });
  await installResourceStyles(directory);
  app = await launchElectron({ cwd: root, args: ['test/fixtures/danmaku-canvas-editor.cjs', directory], timeout: 15000 });
  const desktop = await app.firstWindow(); desktop.setDefaultTimeout(8000);
  const errors = []; desktop.on('pageerror', error => errors.push(error.message));
  await app.evaluate(() => Object.assign(global.canvasTest.openingSettings, { songBoardSyncTheme: 'false', songBoardTitle: '客户端已保存' }));
  await mountResourceStylePage(desktop);
  await desktop.evaluate(async markup => {
    const section = new DOMParser().parseFromString(markup, 'text/html').body.firstElementChild;
    section.style.display = 'block'; document.body.append(section);
    const status = document.createElement('span'); status.id = 'wsStatus'; document.body.append(status);
    const { display } = await import('/js/admin/display.js');
    display.initDisplayForm();
    const { createAdminStateRenderer } = await import('/js/admin/state-renderer.js');
    const { eventBus, Events } = await import('/js/shared/event-bus.js');
    eventBus.on(Events.STATE_LOADED, createAdminStateRenderer({ renderGifts() {}, renderQueueStyle() {} }));
    const { stateService } = await import('/js/admin/state.js');
    stateService.connectSocket();
    const { openComponentPreview } = await import('/js/admin/component-preview-dialog.js');
    openComponentPreview();
  }, fs.readFileSync(path.join(root, 'public/pages/admin/song/song-board.html'), 'utf8'));
  await desktop.waitForFunction(() => document.getElementById('songBoardTitle').value === '客户端已保存');
  let url;
  for (let i = 0; i < 100 && !url; i++) {
    url = await app.evaluate(() => global.canvasTest.externalUrls.at(-1));
    if (!url) await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal((await fetch(url)).status, 200);
  browser = await chromium.launch({ headless: true });
  const canvas = await browser.newPage({ viewport: { width: 1600, height: 1000 } }); canvas.setDefaultTimeout(8000);
  canvas.on('pageerror', error => errors.push(error.message));
  await canvas.goto(url);
  async function add(type, name) {
    await canvas.getByRole('button', { name: '添加组件', exact: true }).click();
    await canvas.locator(`[data-category="${type}"]`).click();
    await canvas.getByRole('button', { name: `添加${name}`, exact: true }).click();
  }
  await add('songlist', '展示板');
  const title = canvas.locator('[data-component-parameter="songBoardTitle"]');
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="songBoardTitle"]').value === '客户端已保存');
  await title.fill('画布修改');
  await desktop.waitForFunction(() => document.getElementById('songBoardTitle').value === '画布修改');
  await add('songlist', '展示板');
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="songBoardTitle"]').value === '画布修改');
  await desktop.locator('#songBoardTitle').fill('客户端修改');
  await desktop.locator('#songBoardFontSizeNumber').fill('38');
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="songBoardTitle"]').value === '客户端修改'
    && document.querySelector('[data-component-parameter="songBoardFontSize"]').value === '38');
  for (const layer of await canvas.locator('.scene-editor-item[data-component="songlist"]').all()) {
    await layer.frameLocator('iframe').locator('#songBoardTitle').filter({ hasText: '客户端修改' }).waitFor();
  }
  await desktop.getByRole('button', { name: '调整样式：配套歌词', exact: true }).click();
  const resource = desktop.getByRole('region', { name: '配套歌词设置', exact: true });
  const desktopSize = resource.getByLabel('字号', { exact: true });
  await desktopSize.fill('54'); await desktopSize.dispatchEvent('change');
  await resource.getByRole('button', { name: '保存设置', exact: true }).click();
  await resource.getByRole('status').filter({ hasText: '已保存并同步' }).waitFor();
  await canvas.getByRole('button', { name: '添加组件', exact: true }).click();
  await canvas.locator('[data-category="lyrics"]').click();
  await canvas.getByRole('button', { name: '添加到画布：配套歌词', exact: true }).click();
  const canvasSize = canvas.locator('[data-component-parameter="desktopLyricFontSize"]');
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="desktopLyricFontSize"]').value === '54');
  await canvasSize.fill('62'); await canvasSize.dispatchEvent('change');
  await canvasSize.blur();
  await desktop.waitForFunction(() => document.querySelector('[data-resource-style-settings]:not([hidden]) [data-component-parameter="desktopLyricFontSize"]').value === '62');
  await desktopSize.fill('70'); await desktopSize.dispatchEvent('change');
  await resource.getByRole('button', { name: '保存设置', exact: true }).click();
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="desktopLyricFontSize"]').value === '70');
  await canvas.getByRole('button', { name: '保存并应用', exact: true }).click();
  await canvas.getByRole('status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
  await canvas.screenshot({ path: path.join(root, 'tmp/shared-canvas-appearance.png'), fullPage: true });
  await canvas.reload();
  await canvas.locator('.preview-canvas-layer-select').filter({ hasText: '配套歌词' }).click();
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="desktopLyricFontSize"]').value === '70');
  assert.deepEqual(errors, []);
});
