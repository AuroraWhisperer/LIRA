'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowser = useSharedBrowser();
const publicRoot = path.resolve(__dirname, '../../public');
const drawerHtml = fs.readFileSync(path.join(publicRoot, 'pages/admin/playback/drawer.html'), 'utf8');

test('closed playback drawer leaves Tab order and restores its trigger', async (t) => {
  const browser = openBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1024, height: 720 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    assert.equal(url.hostname, 'playback.test');
    if (url.pathname === '/') return route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/playback/drawer.css"><button id="opener">歌单</button>${drawerHtml}<button id="after">其他操作</button>`,
    });
    const file = path.resolve(publicRoot, '.' + url.pathname);
    assert.ok(file.startsWith(publicRoot + path.sep));
    return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript' });
  });
  await page.goto('http://playback.test/');
  const checkClosedTabOrder = async () => {
    await page.locator('#opener').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'after');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'opener');
    assert.equal(await page.locator('#playbackDrawer').evaluate((element) => element.inert), true);
  };
  await checkClosedTabOrder();
  await page.evaluate(async () => {
    const { Drawer } = await import('/js/playback/ui/drawer.js');
    const { createEventHandlers } = await import('/js/playback/core/event-handlers.js');
    const { createHomeHandler } = await import('/js/playback/features/home-handler.js');
    window.drawer = new Drawer();
    window.drawer.init();
    window.homeHandler = createHomeHandler({
      playbackState: {},
      homeService: { goBack: () => null, clearHomeState() {}, clearHistory() {} },
      uiRenderer: { getDrawer: () => window.drawer },
    });
    createEventHandlers({
      playbackState: {}, getPlaybackAudio: () => null,
      closePlaybackDrawer: window.homeHandler.closePlaybackDrawer,
      playbackDrawerGoBack: window.homeHandler.playbackDrawerGoBack,
    }).setupEventHandlers();
    document.getElementById('opener').addEventListener('click', () => {
      window.drawer.open('歌单', '测试歌曲');
      window.drawer.updateActions(true);
    });
  });
  for (const close of ['button', 'backdrop', 'back']) {
    await page.locator('#opener').click();
    assert.equal(await page.locator('#playbackDrawer').evaluate((element) => element.inert), false);
    await page.locator('#playbackDrawerShuffleAll').focus();
    if (close === 'button') await page.locator('#playbackDrawerClose').click();
    else if (close === 'backdrop') await page.locator('#playbackDrawerBackdrop').click({ position: { x: 20, y: 600 } });
    else await page.evaluate(() => window.homeHandler.playbackDrawerGoBack());
    assert.equal(await page.evaluate(() => document.activeElement.id), 'opener', `focus after ${close}`);
    await checkClosedTabOrder();
  }
  assert.deepEqual(errors, []);
});
