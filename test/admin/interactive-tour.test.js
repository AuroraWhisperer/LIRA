'use strict';

const assert = require('node:assert/strict');

const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

async function openTour(t) {
  const server = await startComponentPreviewServer({ parentHtml: '<!doctype html><link rel="stylesheet" href="/css/styles-base.css"><link rel="stylesheet" href="/css/admin/toolbox/interactive-tour.css"><body></body>' });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await server.close(); });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const url = `${server.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async () => {
    const { createInteractiveTourController } = await import('/js/admin/interactive-tour.js');
    window.tour = createInteractiveTourController();
  });
  return page;
}

let tour;
test.before(async () => {
  tour = await loadModuleExports(path.join(__dirname, '../..', 'public', 'js', 'admin', 'interactive-tour.js'), {
    window: {},
  });
});

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test('tour auto-opens only once for a fresh installation profile', () => {
  const freshStorage = createStorage();

  assert.equal(tour.claimFirstRunTour(freshStorage), true);
  assert.equal(freshStorage.getItem(tour.TOUR_FIRST_RUN_SHOWN_KEY), '1');
  assert.equal(tour.claimFirstRunTour(freshStorage), false);
});

test('tour version changes do not reopen it for existing installations', () => {
  const legacyCompletion = createStorage({ liraTourCompleted: '' });
  const oldCompletion = createStorage({ liraTourCompleted: '1' });
  const currentCompletion = createStorage({
    liraTourCompleted: String(tour.TOUR_VERSION),
  });

  assert.equal(tour.claimFirstRunTour(legacyCompletion), false);
  assert.equal(tour.claimFirstRunTour(oldCompletion), false);
  assert.equal(tour.claimFirstRunTour(currentCompletion), false);
});

test('manual tour reset reopens the guide without clearing display or completion history', async t => {
  const page = await openTour(t);
  const stored = { liraTourCompleted: '1', liraTourFirstRunShown: '1' };
  await page.evaluate(values => {
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
    window.tour.reset();
  }, stored);
  assert.equal(await page.locator('.lira-tour').isVisible(), true);
  assert.equal(await page.evaluate(() => window.tour.claimAutoOpen()), false);
  assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))), stored);
});

test('tour waits for the saved room and an actually connected live status', async () => {
  const window = {};
  const roomInput = { value: '12345' };
  const data = { settings: { roomId: '12345' } };
  const config = await loadModuleExports(
    path.join(__dirname, '../helpers/interactive-tour-graph.js'),
    {
      window,
      document: { getElementById: (id) => id === 'roomId' ? roomInput : null },
      fetch: async () => ({ json: async () => ({ ok: true, data }) }),
    },
  );
  const roomStep = config.TOUR_CONFIG_STEPS.find((step) => step.id === 'room-id');
  const liveStep = config.TOUR_CONFIG_STEPS.find((step) => step.id === 'refresh-live');
  assert.equal(roomStep.checkCompleted(), false);
  await config.stateService.reloadState();
  assert.equal(roomStep.checkCompleted(), true);
  roomInput.value = '67890';
  assert.equal(roomStep.checkCompleted(), false);
  for (const [connected, message, completed] of [
    [false, '正在连接', false],
    [true, '弹幕监听中', true],
    [true, '未开播，历史消息监听中', true],
    [true, '直播弹幕长连失败，历史消息监听中', false],
  ]) {
    data.liveStatus = { connected, message };
    await config.stateService.reloadState();
    assert.equal(liveStep.checkCompleted(), completed, message);
  }
});
