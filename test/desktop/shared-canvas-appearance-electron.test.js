'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchElectron } = require('../helpers/shared-electron');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');
const { installResourceStyles, mountResourceStylePage } = require('../helpers/resource-style-fixture');
const { readAdminFragmentHtml } = require('../helpers/admin-html');

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
  await app.evaluate(() => { global.canvasTest.nowPlaying = { trackTitle: '双组件实播歌曲', artists: ['合成歌手'], playing: true }; });
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
  const geometry = canvas.locator('.scene-editor-geometry');
  for (const [label, value] of [['X', 180], ['Y', 230], ['宽度', 240], ['高度', 240]]) {
    await geometry.getByLabel(label, { exact: true }).fill(String(value));
    await geometry.getByLabel(label, { exact: true }).dispatchEvent('change');
  }
  await add('now-playing', '歌名 / 歌手');
  for (const [label, value] of [['X', 520], ['Y', 240], ['宽度', 460], ['高度', 220]]) {
    await geometry.getByLabel(label, { exact: true }).fill(String(value));
    await geometry.getByLabel(label, { exact: true }).dispatchEvent('change');
  }
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
  assert.equal(await canvas.locator('[data-component-parameter="style"]').isVisible(), false);
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
  const songWidgets = await app.evaluate(() => global.canvasTest.output().document.items.filter(item => item.type === 'now-playing'));
  const recordWidget = songWidgets.find(item => item.appearance.config.nowPlayingPart === 'record');
  const textWidget = songWidgets.find(item => item.appearance.config.nowPlayingPart === 'text');
  assert.deepEqual([recordWidget.x, recordWidget.y, recordWidget.width, recordWidget.height], [180, 230, 240, 240]);
  assert.deepEqual([textWidget.x, textWidget.y, textWidget.width, textWidget.height], [520, 240, 460, 220]);
  assert.equal(recordWidget.appearance.config.style, 'cover');
  await canvas.getByRole('button', { name: '复制场景地址', exact: true }).click();
  await canvas.locator('#previewCanvasSource').waitFor({ state: 'visible' });
  const sourceUrl = await canvas.locator('#previewCanvasSource').textContent();
  assert.equal((await fetch(sourceUrl)).status, 200);
  const live = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await live.goto(sourceUrl);
  const liveRecord = live.frameLocator('iframe[title*="圆形封面"]');
  const liveText = live.frameLocator('iframe[title*="歌名 / 歌手"]');
  await liveRecord.locator('.now-playing-visual').waitFor({ state: 'visible' });
  await liveText.getByText('双组件实播歌曲', { exact: true }).waitFor();
  assert.equal(await liveRecord.locator('.now-playing-copy').isVisible(), false);
  assert.equal(await liveText.locator('.now-playing-visual').isVisible(), false);
  assert.equal(Math.round((await liveRecord.locator('.now-playing-visual').boundingBox()).width), 240);
  await live.close();
  await canvas.reload();
  await canvas.locator('.preview-canvas-layer-select').filter({ hasText: '航海旗帜' }).click();
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="nameFontSize"]').value === '70');
  await canvas.locator('.preview-canvas-layer-select').filter({ hasText: '歌名 / 歌手' }).click();
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="nowPlayingTitleFontSize"]').value === '64'
    && !document.querySelector('[data-component-parameter="nowPlayingShowArtist"]').checked);
  assert.deepEqual(errors, []);
});

test('heart box backgrounds save from desktop and canvas into the published appearance', { timeout: 40000 }, async t => {
  const root = path.resolve(__dirname, '../..');
  const directory = createScratchDirectory('heart-backgrounds-electron-');
  let app;
  let browser;
  t.after(async () => { await browser?.close(); await app?.close(); removeScratchDirectory(directory); });
  app = await launchElectron({ cwd: root, args: ['test/fixtures/danmaku-canvas-editor.cjs', directory], timeout: 15000 });
  const desktop = await app.firstWindow(); desktop.setDefaultTimeout(8000);
  await desktop.waitForFunction(() => document.getElementById('liveDanmakuFeature')?.parentElement === document.body);
  const errors = []; desktop.on('pageerror', error => errors.push(error.message));
  await desktop.evaluate(async markup => {
    const source = new DOMParser().parseFromString(markup, 'text/html');
    const panel = source.body.firstElementChild;
    panel.hidden = false; panel.style.display = 'block'; document.body.prepend(panel);
    const status = document.createElement('span'); status.id = 'wsStatus'; document.body.append(status);
    const { createAdminStateRenderer } = await import('/js/admin/state-renderer.js');
    const { eventBus, Events } = await import('/js/shared/event-bus.js');
    eventBus.on(Events.STATE_LOADED, createAdminStateRenderer({ renderGifts() {}, renderQueueStyle() {}, renderQueue() {} }));
    const { createHeartBoxCollection } = await import('/js/admin/gifts/heart-box-collection.js'); createHeartBoxCollection();
    const { stateService } = await import('/js/admin/state.js'); stateService.connectSocket();
  }, readAdminFragmentHtml('pages/admin/live-components/heart-box-collection.html'));
  await Promise.all([
    desktop.waitForResponse(response => new URL(response.url()).pathname === '/api/settings'
      && response.request().postDataJSON()?.heartBoxCollectionBackgroundStyle === 'sakura' && response.status() === 200),
    desktop.getByLabel('背景样式', { exact: true }).selectOption('sakura'),
  ]);
  await desktop.getByRole('button', { name: '打开画布', exact: true }).click();
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
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="backgroundStyle"]')?.value === 'sakura');
  const preview = canvas.frameLocator('.scene-editor-item[data-component="heart-box-collection"] iframe');
  await preview.locator('.heart-collection[data-background="sakura"]').waitFor();
  const canvasSaved = canvas.waitForResponse(response => new URL(response.url()).pathname === '/api/component-preview/appearance'
    && response.request().postDataJSON()?.patch?.backgroundStyle === 'midnight' && response.status() === 200);
  await canvas.locator('[data-component-parameter="backgroundStyle"]').selectOption('midnight');
  await canvasSaved;
  await desktop.waitForFunction(() => document.getElementById('heartBoxCollectionBackgroundStyle').value === 'midnight');
  await preview.locator('.heart-collection[data-background="midnight"]').waitFor();
  await canvas.getByRole('button', { name: '保存并应用', exact: true }).click();
  await canvas.getByRole('status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
  const output = await app.evaluate(() => global.canvasTest.output());
  const item = output.document.items.find(item => item.type === 'heart-box-collection');
  assert.equal(output.appearances[item.id].backgroundStyle, 'midnight');
  await canvas.reload();
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="backgroundStyle"]')?.value === 'midnight');
  assert.deepEqual(errors, []);
});

test('motion, advanced lyrics and shared viewing controls save through desktop and canvas without replacing layers', { timeout: 90000 }, async t => {
  const root = path.resolve(__dirname, '../..');
  const directory = createScratchDirectory('aligned-parameters-electron-');
  let app;
  let browser;
  t.after(async () => { await browser?.close(); await app?.close(); removeScratchDirectory(directory); });
  app = await launchElectron({ cwd: root, args: ['test/fixtures/danmaku-canvas-editor.cjs', directory], timeout: 15000 });
  const desktop = await app.firstWindow(); desktop.setDefaultTimeout(8000);
  await desktop.waitForFunction(() => document.getElementById('liveDanmakuFeature')?.parentElement === document.body);
  const errors = []; desktop.on('pageerror', error => errors.push(error.message));
  const rows = Array.from({ length: 50 }, (_, index) => ({ rank: index + 1, roomId: String(index + 1), name: `主播 ${index + 1}`, score: 10000 - index }));
  await desktop.route('**/api/bilibili/live-rankings*', route => route.fulfill({ json: {
    ok: true, data: { status: 'ready', room: { roomId: '15' }, boards: [{ id: 'hot', title: '热门全站', unit: '热度值', limit: 100,
      status: 'ready', rows, current: { ...rows[14], distance: 1 }, endsAt: Date.now() + 600000, updatedAt: Date.now() }] },
  } }));
  const markup = ['toolbox/gift', 'song/desktop-lyric', 'live-components/heart-box-collection', 'live-components/live-rankings']
    .map(name => readAdminFragmentHtml(`pages/admin/${name}.html`)).join('\n');
  await desktop.evaluate(async markup => {
    const source = new DOMParser().parseFromString(markup, 'text/html');
    const wrapper = document.createElement('div'); wrapper.id = 'liveComponentsPage'; wrapper.className = 'live-components-page';
    document.body.append(wrapper);
    for (const section of [...source.body.children]) {
      section.hidden = false; section.style.display = 'block'; wrapper.append(section);
      if (section.id === 'desktopLyricPage') {
        section.style.display = 'flex';
        section.style.height = 'calc(100vh - 48px)';
      }
    }
    const status = document.createElement('span'); status.id = 'wsStatus'; document.body.append(status);
    const { createAdminStateRenderer } = await import('/js/admin/state-renderer.js');
    const { eventBus, Events } = await import('/js/shared/event-bus.js');
    eventBus.on(Events.STATE_LOADED, createAdminStateRenderer({ renderGifts() {}, renderQueueStyle() {}, renderQueue() {} }));
    const { initGiftMotionSettings } = await import('/js/admin/gift-motion-settings.js'); initGiftMotionSettings();
    const { desktopLyric } = await import('/js/admin/desktop-lyric.js'); desktopLyric.initDesktopLyricForm();
    const { createHeartBoxCollection } = await import('/js/admin/gifts/heart-box-collection.js'); createHeartBoxCollection();
    const { initLiveRankings } = await import('/js/admin/live-rankings.js'); initLiveRankings();
    const { stateService } = await import('/js/admin/state.js'); stateService.connectSocket();
    const { openComponentPreview } = await import('/js/admin/component-preview-dialog.js'); openComponentPreview();
  }, markup);
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
    if (name) await canvas.getByRole('button', { name: `添加${name}`, exact: true }).click();
    else await canvas.locator('.preview-picker-style').first().click();
  }
  await add('gift-frame', '礼物掉落');
  const size = canvas.locator('[data-component-parameter="giftDropSize"]');
  await size.fill('134'); await size.dispatchEvent('input');
  await desktop.waitForFunction(() => document.getElementById('giftDropSize').value === '134');
  const refresh = canvas.waitForResponse(async response => response.url().includes('/api/component-preview/appearance')
    && response.ok() && (await response.text()).includes('"giftDropSize":"152"'));
  await desktop.locator('#giftDropSize').fill('152'); await desktop.locator('#giftDropSize').dispatchEvent('input');
  const bounce = canvas.locator('[data-component-parameter="giftDropBounce"]');
  await bounce.fill('60'); await bounce.dispatchEvent('input'); await bounce.blur();
  await desktop.waitForFunction(() => document.getElementById('giftDropBounce').value === '60');
  const submitted = desktop.waitForRequest(request => request.url().endsWith('/api/settings')
    && request.method() === 'POST' && request.postDataJSON()?.giftDropSize === '152');
  await size.focus();
  await desktop.locator('#giftDropSaveBtn').click();
  assert.deepEqual((await submitted).postDataJSON(), { giftDropSize: '152' }, 'saving a desktop draft preserves other canvas changes');
  await refresh;
  await size.blur();
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="giftDropSize"]').value === '152');
  await desktop.route('**/api/settings', route => route.fulfill({ status: 500,
    json: { ok: false, error: 'Synthetic local write failure' } }), { times: 1 });
  await desktop.locator('#giftDropSize').fill('160'); await desktop.locator('#giftDropSize').dispatchEvent('input');
  await desktop.locator('#giftDropSaveBtn').click();
  await desktop.locator('#giftDropSaveState[data-state="error"]').waitFor();
  assert.equal(await desktop.locator('#giftDropSize').inputValue(), '160');
  assert.equal(await size.inputValue(), '152');
  await desktop.locator('#giftDropSaveBtn').click();
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="giftDropSize"]').value === '160');
  await add('gift-frame', '礼物摇摇乐');
  await canvas.locator('.gift-motion-canvas-settings:not([hidden])').getByRole('checkbox', { name: '礼物名', exact: true }).uncheck();
  await desktop.waitForFunction(() => document.getElementById('giftSwingTextMode').value === 'name-quantity');
  await add('lyrics', '直播歌词');
  const advanced = canvas.locator('.advanced-lyric-canvas-settings');
  await advanced.getByRole('tab', { name: '外观', exact: true }).click();
  await advanced.locator('[data-advanced-lyric-parameter="advancedLyricFontWeight"]').selectOption('900');
  await advanced.locator('[data-advanced-lyric-parameter="advancedLyricFontStyle"]').selectOption('italic');
  const lineHeight = advanced.getByRole('spinbutton', { name: '换行行距（倍）数值', exact: true });
  await lineHeight.fill('1.6'); await lineHeight.dispatchEvent('change');
  await desktop.locator('#desktopLyricAdvancedTab').click();
  await desktop.waitForFunction(() => document.getElementById('advancedLyricFontWeight')?.value === '900'
    && document.getElementById('advancedLyricFontStyle').value === 'italic'
    && document.getElementById('advancedLyricLineHeight').value === '1.6');
  await desktop.locator('#advancedLyricEditor').getByRole('tab', { name: '外观', exact: true }).click();
  await desktop.locator('#advancedLyricEditor summary').filter({ hasText: /^文字材质/ }).click();
  await desktop.locator('#advancedLyricEditor [data-lyric-field="advancedLyricMaterial"][data-lyric-choice="chalk"]').click();
  await advanced.locator('summary').filter({ hasText: /^文字材质/ }).click();
  await canvas.waitForFunction(() => document.querySelector('.advanced-lyric-canvas-settings [data-lyric-field="advancedLyricMaterial"][data-lyric-choice="chalk"]').getAttribute('aria-pressed') === 'true');
  const texture = desktop.locator('#advancedLyricEditor').getByRole('spinbutton', { name: '纹理大小（倍）数值', exact: true });
  await texture.fill('2.2'); await texture.dispatchEvent('change');
  await canvas.waitForFunction(() => document.querySelector('.advanced-lyric-canvas-settings [data-advanced-lyric-parameter="advancedLyricTextureScale"]').value === '2.2');
  await advanced.getByRole('tab', { name: '编排', exact: true }).click();
  await advanced.locator('[data-lyric-field="advancedLyricLayout"][data-lyric-choice="paper-fold"]').click();
  await desktop.waitForFunction(() => document.querySelector('#advancedLyricEditor [data-lyric-field="advancedLyricLayout"][data-lyric-choice="paper-fold"]').getAttribute('aria-pressed') === 'true');
  await advanced.locator('summary').filter({ hasText: /^位置与尺寸/ }).click();
  const horizontal = advanced.getByRole('spinbutton', { name: '水平位置（%）数值', exact: true });
  const vertical = advanced.getByRole('spinbutton', { name: '垂直位置（%）数值', exact: true });
  await horizontal.fill('24'); await horizontal.dispatchEvent('change');
  await vertical.fill('72'); await vertical.dispatchEvent('change');
  await desktop.waitForFunction(() => document.getElementById('advancedLyricPositionX').value === '24'
    && document.getElementById('advancedLyricPositionY').value === '72');
  await desktop.locator('#advancedLyricEditor').getByRole('tab', { name: '编排', exact: true }).click();
  await desktop.locator('#advancedLyricEditor summary').filter({ hasText: /^位置与尺寸/ }).click();
  await desktop.locator('#advancedLyricEditor').getByRole('button', { name: '水平居中', exact: true }).click();
  await canvas.waitForFunction(() => document.querySelector('.advanced-lyric-canvas-settings [data-advanced-lyric-parameter="advancedLyricPositionX"]').value === '50'
    && document.querySelector('.advanced-lyric-canvas-settings [data-advanced-lyric-parameter="advancedLyricPositionY"]').value === '72');
  await desktop.locator('#advancedLyricEditor [data-lyric-field="advancedLyricLayout"][data-lyric-choice="adaptive"]').click();
  await canvas.waitForFunction(() => document.querySelector('.advanced-lyric-canvas-settings [data-lyric-field="advancedLyricLayout"][data-lyric-choice="adaptive"]').getAttribute('aria-pressed') === 'true');
  await add('heart-box-collection');
  await canvas.locator('[data-component-parameter="showRewards"]').uncheck();
  await desktop.waitForFunction(() => !document.getElementById('heartBoxCollectionShowRewards').checked);
  assert.equal(new URL(await desktop.locator('#heartBoxCollectionUrl').textContent()).search, '', 'new addresses follow the saved visibility');
  await desktop.locator('.heart-box-rewards-toggle').click();
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="showRewards"]').checked);
  await add('live-rankings');
  const rankingList = desktop.locator('[data-rankings="boards"] .ranking-card').first().locator('.ranking-list');
  await desktop.waitForFunction(count => document.querySelector('[data-rankings="boards"] .ranking-list').children.length === count, rows.length);
  await canvas.getByRole('button', { name: '展示方式', exact: true }).click();
  await canvas.getByRole('option', { name: '跟随本房间名次', exact: true }).click();
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="range"]').value === 'nearby');
  await rankingList.locator('.is-current .ranking-place').filter({ hasText: /^15$/ }).waitFor();
  assert.equal(await rankingList.locator('.ranking-place').first().textContent(), '1', 'desktop keeps the complete list when canvas follows the current room');
  assert.equal(await rankingList.locator('.ranking-place').last().textContent(), String(rows.length));
  assert.equal(await rankingList.locator('.is-current').count(), 1);
  await canvas.getByRole('button', { name: '保存并应用', exact: true }).click();
  await canvas.getByRole('status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
  const output = await app.evaluate(() => global.canvasTest.output());
  const appearance = type => output.appearances[output.document.items.find(item => item.type === type).id];
  assert.equal(appearance('lyrics').advancedLyricLayout, 'adaptive');
  assert.equal(appearance('lyrics').advancedLyricMaterial, 'chalk');
  assert.equal(appearance('lyrics').advancedLyricFontStyle, 'italic');
  assert.equal(appearance('lyrics').advancedLyricLineHeight, '1.6');
  assert.equal(appearance('lyrics').advancedLyricTextureScale, '2.2');
  assert.equal(appearance('lyrics').advancedLyricPositionX, '50');
  assert.equal(appearance('lyrics').advancedLyricPositionY, '72', 'horizontal centering preserves the other position axis');
  assert.equal(Object.hasOwn(appearance('lyrics'), 'advancedLyricSavedPresets'), false);
  assert.equal(appearance('heart-box-collection').showRewards, true);
  assert.equal(appearance('live-rankings').range, 'nearby');
  const motionLayer = output.document.items.find(item => item.type === 'gift-frame');
  assert.equal(Object.hasOwn(motionLayer.appearance.config, 'giftDropSize'), false);
  await canvas.reload();
  await canvas.locator('.preview-canvas-layer-select').filter({ hasText: '礼物掉落' }).click();
  await canvas.waitForFunction(() => document.querySelector('[data-component-parameter="giftDropSize"]').value === '160');
  assert.deepEqual(errors, []);
});
