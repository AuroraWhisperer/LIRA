'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchElectron } = require('../helpers/shared-electron');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');
const { installResourceStyles, mountResourceStylePage } = require('../helpers/resource-style-fixture');

test('overtime canvas changes the real desktop countdown and saved output in both directions', { timeout: 60000 }, async t => {
  const root = path.resolve(__dirname, '../..');
  const directory = createScratchDirectory('overtime-canvas-electron-');
  let app;
  let browser;
  t.after(async () => { await browser?.close(); await app?.close(); removeScratchDirectory(directory); });
  app = await launchElectron({ cwd: root, args: ['test/fixtures/danmaku-canvas-editor.cjs', directory, '--overtime'], timeout: 15000 });
  const desktop = await app.firstWindow(); desktop.setDefaultTimeout(8000);
  await desktop.waitForFunction(() => document.getElementById('liveDanmakuFeature')?.parentElement === document.body);
  const errors = []; desktop.on('pageerror', error => errors.push(error.message));
  const initial = await app.evaluate(() => {
    const overtime = global.canvasTest.overtime;
    overtime.setTime({ initialSeconds: 900, remainingSeconds: 900 });
    return overtime.act('enable');
  });
  await desktop.evaluate(async ({ markup, initial }) => {
    const source = new DOMParser().parseFromString(markup, 'text/html');
    for (const section of [...source.body.children]) {
      section.hidden = false; section.style.display = 'block'; document.body.append(section);
    }
    const { initOvertime } = await import('/js/admin/overtime.js');
    initOvertime({ overtime: initial });
    const { enhanceSelects } = await import('/js/shared/select-menu.js');
    enhanceSelects(document.getElementById('overtimePanel'));
    const { stateService } = await import('/js/admin/state.js');
    stateService.connectSocket();
    const { openComponentPreview } = await import('/js/admin/component-preview-dialog.js');
    openComponentPreview();
  }, { markup: fs.readFileSync(path.join(root, 'public/pages/admin/toolbox/overtime.html'), 'utf8'), initial });
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
  await canvas.getByRole('button', { name: '添加组件', exact: true }).click();
  await canvas.locator('[data-category="overtime"]').click();
  await canvas.locator('.preview-picker-style').first().click();
  const minutes = canvas.getByRole('spinbutton', { name: '初始时长（分钟）', exact: true });
  await minutes.waitFor();
  await canvas.waitForFunction(() => document.querySelector('[aria-label="初始时长（分钟）"]').value === '15');
  await minutes.fill('32');
  await canvas.getByRole('spinbutton', { name: '初始时长（秒）', exact: true }).fill('4');
  await canvas.getByRole('button', { name: '设置并重置倒计时', exact: true }).click();
  await canvas.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await app.evaluate(() => global.canvasTest.overtime.getSnapshot().initialSeconds), 900);
  assert.equal(await minutes.inputValue(), '32');
  await canvas.getByRole('button', { name: '设置并重置倒计时', exact: true }).click();
  await canvas.getByRole('dialog').getByRole('button', { name: '设置并重置', exact: true }).click();
  await desktop.waitForFunction(() => document.getElementById('overtimeInitialMinutes').value === '32'
    && document.getElementById('overtimeClockValue').textContent.includes('32:04'));
  assert.equal(await app.evaluate(() => global.canvasTest.overtime.getSnapshot().initialSeconds), 1924);
  await canvas.getByRole('button', { name: '开始倒计时', exact: true }).click();
  await desktop.waitForFunction(() => document.getElementById('overtimeStartBtn').textContent.includes('暂停'));
  await desktop.locator('#overtimeStartBtn').click();
  await canvas.getByRole('button', { name: '开始倒计时', exact: true }).waitFor();
  await desktop.locator('#overtimeInitialHours').fill('1');
  await desktop.locator('#overtimeInitialMinutes').fill('7');
  await desktop.getByText('更多操作', { exact: true }).click();
  await desktop.locator('#overtimeApplyTimeBtn').click();
  await desktop.getByRole('dialog').getByRole('button', { name: '设置并重置', exact: true }).click();
  await canvas.waitForFunction(() => document.querySelector('[aria-label="初始时长（小时）"]').value === '1'
    && document.querySelector('[aria-label="初始时长（分钟）"]').value === '7');
  const frame = canvas.frameLocator('.scene-editor-item[data-component="overtime"] iframe');
  await frame.locator('#overtimeClock').filter({ hasText: '01:07:00' }).waitFor();
  await canvas.getByRole('button', { name: '背景', exact: true }).click();
  await canvas.getByRole('option', { name: '深夜票券', exact: true }).click();
  await canvas.getByRole('button', { name: '适配', exact: true }).click();
  await canvas.getByRole('option', { name: '拉伸', exact: true }).click();
  await canvas.getByRole('button', { name: '保存并应用', exact: true }).click();
  await canvas.locator('.preview-canvas-status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
  await desktop.getByText('直播画面与背景', { exact: true }).click();
  assert.equal(await desktop.locator('#overtimeBackgroundFit').inputValue(), 'fill');
  await desktop.getByRole('button', { name: '适配', exact: true }).click();
  await desktop.getByRole('option', { name: '完整显示', exact: true }).click();
  await desktop.locator('#overtimeSaveBackgroundBtn').click();
  await canvas.waitForFunction(() => document.querySelector('[data-preview-field="overtimeBackgroundFit"]').value === 'contain');
  const output = await app.evaluate(() => global.canvasTest.output());
  const item = output.document.items.find(item => item.type === 'overtime');
  assert.equal(output.data.overtime.effectiveRemainingMs, 4020000);
  assert.equal(output.appearances[item.id].fit, 'contain');
  await canvas.reload();
  await canvas.locator('.preview-canvas-layer-select').filter({ hasText: '加班机' }).click();
  await canvas.waitForFunction(() => document.querySelector('[aria-label="初始时长（分钟）"]').value === '7');
  assert.equal(await canvas.locator('[data-preview-field="overtimeBackgroundPath"]').inputValue(), '/img/overtime-machine/midnight-grid.svg');
  assert.deepEqual(errors, []);
});

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
  await app.evaluate(() => Object.assign(global.canvasTest.openingSettings, { songBoardSyncTheme: 'false', songBoardTitle: '客户端已保存',
    nowPlayingAppearance: JSON.stringify({ style: 'vinyl', nowPlayingTitleFontSize: 44 }) }));
  await mountResourceStylePage(desktop);
  await desktop.evaluate(async markup => {
    const source = new DOMParser().parseFromString(markup, 'text/html');
    for (const section of [...source.body.children]) {
      section.hidden = false; section.style.display = 'block'; document.body.append(section);
    }
    const status = document.createElement('span'); status.id = 'wsStatus'; document.body.append(status);
    const { display } = await import('/js/admin/display.js');
    display.initDisplayForm();
    const { createAdminStateRenderer } = await import('/js/admin/state-renderer.js');
    const { eventBus, Events } = await import('/js/shared/event-bus.js');
    eventBus.on(Events.STATE_LOADED, createAdminStateRenderer({ renderGifts() {}, renderQueueStyle() {} }));
    const { stateService } = await import('/js/admin/state.js');
    stateService.connectSocket();
    const { initNowPlaying } = await import('/js/admin/now-playing.js');
    initNowPlaying();
    const { openComponentPreview } = await import('/js/admin/component-preview-dialog.js');
    openComponentPreview();
  }, fs.readFileSync(path.join(root, 'public/pages/admin/song/song-board.html'), 'utf8')
    + fs.readFileSync(path.join(root, 'public/pages/admin/live-components/now-playing.html'), 'utf8'));
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
  await add('now-playing', '圆形封面');
  const canvasTitleSize = canvas.locator('[data-component-parameter="nowPlayingTitleFontSize"]');
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="nowPlayingTitleFontSize"]').value === '44');
  await canvasTitleSize.fill('58'); await canvasTitleSize.dispatchEvent('change'); await canvasTitleSize.blur();
  await desktop.waitForFunction(() => document.querySelector('#nowPlayingParameters [data-component-parameter="nowPlayingTitleFontSize"]').value === '58');
  const desktopTitleSize = desktop.locator('#nowPlayingParameters [data-component-parameter="nowPlayingTitleFontSize"]');
  await desktopTitleSize.fill('64'); await desktopTitleSize.dispatchEvent('change');
  await desktop.getByRole('checkbox', { name: '显示歌手', exact: true }).uncheck();
  await desktop.locator('#nowPlayingSave').click();
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="nowPlayingTitleFontSize"]').value === '64'
    && !document.querySelector('[data-component-parameter="nowPlayingShowArtist"]').checked);
  assert.equal(await canvas.locator('[data-component-parameter="style"]').inputValue(), 'cover');
  assert.equal(await desktop.locator('[data-now-playing-style="vinyl"]').getAttribute('aria-pressed'), 'true');
  const resource = desktop.getByRole('region', { name: '航海旗帜设置', exact: true });
  await resource.getByText('外观设置', { exact: true }).click();
  const desktopSize = resource.locator('[data-component-parameter="nameFontSize"]');
  await desktopSize.fill('54'); await desktopSize.dispatchEvent('change');
  await resource.getByRole('button', { name: '保存设置', exact: true }).click();
  await resource.getByRole('status').filter({ hasText: '已保存并同步' }).waitFor();
  await canvas.getByRole('button', { name: '添加组件', exact: true }).click();
  await canvas.locator('[data-category="guard-thanks"]').click();
  await canvas.getByRole('button', { name: '添加到画布：航海旗帜', exact: true }).click();
  const canvasSize = canvas.locator('[data-component-parameter="nameFontSize"]');
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="nameFontSize"]').value === '54');
  await canvasSize.fill('62'); await canvasSize.dispatchEvent('change');
  await canvasSize.blur();
  await desktop.waitForFunction(() => document.querySelector('[data-resource-style-settings]:not([hidden]) [data-component-parameter="nameFontSize"]').value === '62');
  await desktopSize.fill('70'); await desktopSize.dispatchEvent('change');
  await resource.getByRole('button', { name: '保存设置', exact: true }).click();
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="nameFontSize"]').value === '70');
  await canvas.getByRole('button', { name: '保存并应用', exact: true }).click();
  await canvas.getByRole('status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
  await canvas.reload();
  await canvas.locator('.preview-canvas-layer-select').filter({ hasText: '航海旗帜' }).click();
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="nameFontSize"]').value === '70');
  await canvas.locator('.preview-canvas-layer-select').filter({ hasText: '圆形封面' }).click();
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="nowPlayingTitleFontSize"]').value === '64'
    && !document.querySelector('[data-component-parameter="nowPlayingShowArtist"]').checked);
  assert.deepEqual(errors, []);
});
