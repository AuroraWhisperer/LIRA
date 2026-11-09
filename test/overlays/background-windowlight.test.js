'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

const openBrowserSession = useSharedBrowser();

async function harness(t) {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/background.css">
    <link rel="stylesheet" href="/css/overlays/background-windowlight.css">
    <div id="windowlightBackground" hidden></div>` });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  assert.equal((await fetch(`${fixture.origin}/preview-test-host`)).status, 200);
  await page.clock.install({ time: '2026-10-10T00:00:00Z' });
  await page.goto(`${fixture.origin}/preview-test-host`);
  await page.clock.pauseAt('2026-10-10T00:01:00Z');
  await page.evaluate(async () => {
    const { createWindowlightBackground } = await import('/js/overlays/background-windowlight.js');
    window.root = document.getElementById('windowlightBackground');
    window.background = createWindowlightBackground(root);
    window.config = { style: 'windowlight', windowScene: 'sunny', sceneMode: 'manual', sceneIntervalSeconds: 10 };
    window.apply = (changes = {}, options = {}) => {
      Object.assign(config, changes);
      return background.update(config, { reducedMotion: true, ...options });
    };
  });
  return { page, root: page.locator('#windowlightBackground'),
    update: (changes = {}, options = {}) => page.evaluate(({ changes, options }) => apply(changes, options), { changes, options }),
    scene: () => page.locator('#windowlightBackground').getAttribute('data-scene') };
}

async function holdImageDecodes(page) {
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    window.decodes = [];
    HTMLImageElement.prototype.decode = function () {
      return new Promise((resolve, reject) => {
        decodes.push({ resolve: () => decode.call(this).then(resolve, reject), reject });
      });
    };
  });
}

test('manual windowlight scenes switch without duplicating layers', async t => {
  const h = await harness(t);
  await h.update({ windowScene: 'sunny' });
  const layerCount = await h.root.locator('*').count();
  for (const windowScene of ['sunny', 'sunset', 'rainy', 'night', 'sunny']) {
    await h.update({ windowScene }, { reducedMotion: true });
    assert.equal(await h.scene(), windowScene);
    assert.equal(await h.root.locator('.windowlight-plate.is-active').count(), 1);
  }
  assert.equal(await h.root.locator('*').count(), layerCount);
});

test('automatic windowlight scenes start at the selection and loop in order every ten seconds', async t => {
  const h = await harness(t);
  await h.update({ windowScene: 'sunset', sceneMode: 'auto' });
  assert.equal(await h.scene(), 'sunset');
  await h.page.clock.runFor(9999);
  assert.equal(await h.scene(), 'sunset');
  await h.page.clock.runFor(1);
  assert.equal(await h.scene(), 'rainy');
  for (const expected of ['night', 'sunny', 'sunset']) {
    await h.page.clock.runFor(10000);
    assert.equal(await h.scene(), expected);
  }
});

test('appearance updates preserve the current scene, countdown and a single automatic rotation', async t => {
  const h = await harness(t);
  await h.update({ sceneMode: 'auto' });
  await h.page.evaluate(() => {
    window.sceneChanges = 0;
    new MutationObserver(records => { sceneChanges += records.length; })
      .observe(root, { attributes: true, attributeFilter: ['data-scene'] });
  });
  await h.page.clock.runFor(14000);
  assert.equal(await h.scene(), 'sunset');
  for (let i = 0; i < 5; i++) await h.update({ temperature: i * 10, brightness: 1 + i / 10 });
  assert.equal(await h.scene(), 'sunset');
  await h.page.clock.runFor(5999);
  assert.equal(await h.scene(), 'sunset');
  await h.page.clock.runFor(1);
  assert.equal(await h.scene(), 'rainy');
  await h.page.clock.runFor(10000);
  assert.equal(await h.scene(), 'night');
  assert.equal(await h.page.evaluate(() => sceneChanges), 3);
});

test('hidden windowlight freezes water and resumes the remaining automatic interval', async t => {
  const h = await harness(t);
  await h.update({ sceneMode: 'auto', windowScene: 'rainy' }, { reducedMotion: false });
  await h.page.clock.runFor(4000);
  await h.update({}, { visible: false, reducedMotion: false });
  const water = () => h.root.locator('.windowlight-rain').evaluate(canvas => canvas.toDataURL());
  const paused = await water();
  await h.page.clock.runFor(60000);
  assert.equal(await water(), paused, 'No water simulation runs while hidden.');
  assert.equal(await h.scene(), 'rainy');
  await h.update({}, { visible: true, reducedMotion: false });
  await h.page.clock.runFor(1000);
  assert.notEqual(await water(), paused, 'The visible page resumes the existing water simulation.');
  await h.page.clock.runFor(4999);
  assert.equal(await h.scene(), 'rainy');
  await h.page.clock.runFor(1);
  assert.equal(await h.scene(), 'night');
});

test('manual selection cancels automatic switching and a changed interval starts a new countdown', async t => {
  const h = await harness(t);
  await h.update({ sceneMode: 'auto' });
  await h.page.clock.runFor(4000);
  await h.update({ sceneMode: 'manual', windowScene: 'rainy' });
  await h.page.clock.runFor(60000);
  assert.equal(await h.scene(), 'rainy');
  await h.update({ sceneMode: 'auto' });
  await h.page.clock.runFor(4000);
  await h.update({ sceneIntervalSeconds: 20 });
  await h.page.clock.runFor(19999);
  assert.equal(await h.scene(), 'rainy');
  await h.page.clock.runFor(1);
  assert.equal(await h.scene(), 'night');
});

test('reduced motion freezes effects but keeps automatic scene selection', async t => {
  const h = await harness(t);
  await h.update({ sceneMode: 'auto', windowScene: 'rainy' }, { reducedMotion: true });
  const water = () => h.root.locator('.windowlight-rain').evaluate(canvas => canvas.toDataURL());
  const paused = await water();
  await h.page.clock.runFor(1000);
  assert.equal(await water(), paused);
  await h.page.clock.runFor(9000);
  assert.equal(await h.scene(), 'night');
  await h.update({ windowScene: 'rainy', sceneMode: 'manual' }, { reducedMotion: false });
  await h.page.clock.runFor(1000);
  assert.notEqual(await water(), paused);
});

test('disposal clears visible layers and stops all future automatic updates', async t => {
  const h = await harness(t);
  await h.update({ sceneMode: 'auto' });
  await h.page.clock.runFor(4000);
  await h.page.evaluate(() => { background.dispose(); background.dispose(); });
  await h.page.clock.runFor(30000);
  await h.update({ windowScene: 'night' });
  assert.equal(await h.root.isVisible(), false);
  assert.equal(await h.root.locator('*').count(), 0);
  assert.equal(await h.scene(), 'sunny');
});

test('failed image preparation stays hidden and a retry waits for its own decoded images', async t => {
  const h = await harness(t);
  await holdImageDecodes(h.page);
  await h.page.evaluate(() => {
    window.firstLoad = apply({ sceneMode: 'auto' }).then(() => '', error => error.message);
  });
  assert.equal(await h.root.isVisible(), false);
  await h.page.evaluate(() => decodes[0].reject(new Error('Image unavailable')));
  assert.equal(await h.page.evaluate(() => firstLoad), 'Image unavailable');
  await h.page.clock.runFor(30000);
  assert.equal(await h.scene(), 'sunny');
  assert.equal(await h.root.isVisible(), false);
  await h.page.evaluate(async () => {
    const older = decodes.splice(0);
    window.retryLoad = apply();
    await Promise.all(older.slice(1).map(item => item.resolve()));
  });
  assert.equal(await h.root.isVisible(), false);
  await h.page.evaluate(async () => {
    await Promise.all(decodes.map(item => item.resolve()));
    await retryLoad;
  });
  assert.equal(await h.root.isVisible(), true);
  await h.page.clock.runFor(10000);
  assert.equal(await h.scene(), 'sunset');
});

test('late image preparation cannot reveal an inactive or disposed background', async t => {
  const h = await harness(t);
  await holdImageDecodes(h.page);
  await h.page.evaluate(() => { window.loading = apply({ sceneMode: 'auto' }); });
  await h.update({ style: 'moonlit' });
  await h.page.evaluate(async () => {
    await Promise.all(decodes.map(item => item.resolve()));
    await loading;
  });
  await h.page.clock.runFor(30000);
  assert.equal(await h.root.isVisible(), false);
  assert.equal(await h.scene(), 'sunny');
  await h.page.evaluate(async () => {
    background.dispose();
    const { createWindowlightBackground } = await import('/js/overlays/background-windowlight.js');
    window.background = createWindowlightBackground(root);
    decodes.length = 0;
    window.loading = apply({ style: 'windowlight', windowScene: 'night' });
    background.dispose();
    await Promise.all(decodes.map(item => item.resolve()));
    await loading;
  });
  await h.page.clock.runFor(30000);
  assert.equal(await h.root.isVisible(), false);
  assert.equal(await h.root.locator('*').count(), 0);
  assert.equal(await h.scene(), 'night');
});
