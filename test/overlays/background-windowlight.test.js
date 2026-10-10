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

test('manual windowlight scenes display four decoded plates without duplicating layers', async t => {
  const h = await harness(t);
  for (const windowScene of ['sunny', 'sunset', 'rainy', 'night', 'sunny']) {
    await h.update({ windowScene }, { reducedMotion: true });
    assert.equal(await h.root.isVisible(), true);
    assert.equal(await h.scene(), windowScene);
    const active = h.root.locator('.windowlight-plate.is-active');
    assert.equal(await active.count(), 1);
    assert.deepEqual(await active.evaluate(image => ({
      name: image.src.split('/').at(-1), decoded: image.complete && image.naturalWidth > 0,
      opacity: getComputedStyle(image).opacity,
    })), { name: `${windowScene}.webp`, decoded: true, opacity: '1' });
  }
  assert.equal(await h.root.locator('.windowlight-plate').count(), 4);
  assert.equal(await h.root.locator('.windowlight-effect').count(), 3);
  assert.equal(await h.root.locator('.windowlight-rain').count(), 1);
});

test('manual scenes animate local illumination and glass water without moving the painting', async t => {
  const h = await harness(t);
  const movement = [];
  for (const windowScene of ['sunny', 'sunset', 'rainy', 'night']) {
    await h.update({ windowScene }, { reducedMotion: true });
    await h.update({}, { reducedMotion: false });
    await h.root.evaluate(root => { for (const animation of root.getAnimations({ subtree: true })) animation.finish(); });
    const count = await h.root.locator('*').count();
    await h.page.clock.runFor(100);
    const first = (await h.page.screenshot()).toString('base64');
    await h.page.clock.runFor(1000);
    const second = (await h.page.screenshot()).toString('base64');
    const difference = await h.page.evaluate(async ({ first, second }) => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const context = canvas.getContext('2d');
      const read = async source => {
        const image = new Image(); image.src = `data:image/png;base64,${source}`; await image.decode();
        context.clearRect(0, 0, 640, 360); context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, 640, 360).data;
      };
      const before = await read(first); const after = await read(second);
      let changed = 0; let pronounced = 0; let leftWall = 0;
      for (let i = 0; i < before.length; i += 4) {
        const contrast = Math.max(...[0, 1, 2].map(channel => Math.abs(before[i + channel] - after[i + channel])));
        if (contrast < 3) continue;
        changed++;
        if (contrast >= 12) pronounced++;
        if (i / 4 % 640 < 160) leftWall++;
      }
      return { changed, pronounced, leftWall };
    }, { first, second });
    assert.ok(difference.changed > 20, `${windowScene}: rendered movement: ${JSON.stringify(difference)}`);
    if (['sunny', 'sunset'].includes(windowScene)) assert.ok(difference.pronounced > 1200,
      `${windowScene}: daylight is perceptible within one second: ${JSON.stringify(difference)}`);
    if (windowScene === 'night') {
      assert.ok(difference.pronounced > 100, 'Narrow lamp reflections remain perceptible.');
      assert.equal(difference.leftWall, 0, 'Lamp reflections never pulse the unlit far wall.');
    }
    assert.ok((await h.root.locator('.windowlight-plate').evaluateAll(plates => plates.map(plate => getComputedStyle(plate).transform)))
      .every(transform => transform === 'none'), 'Fixed objects never drift.');
    assert.equal(await h.root.locator('*').count(), count, 'Motion reuses its mounted surfaces.');
    movement.push({ windowScene, ...difference });
  }
  t.diagnostic(`Rendered changes over one second: ${JSON.stringify(movement)}`);
});

test('1080p rain refraction is clipped to the glass and follows artwork fitting', async t => {
  const h = await harness(t);
  await h.update({ windowScene: 'rainy' });
  const pixels = await h.root.locator('.windowlight-rain').evaluate(async rain => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920; canvas.height = 1080;
    const context = canvas.getContext('2d');
    context.drawImage(rain, 0, 0);
    context.globalCompositeOperation = 'destination-in';
    const mask = new Image();
    mask.src = getComputedStyle(rain).maskImage.slice(5, -2); await mask.decode();
    context.drawImage(mask, 0, 0);
    const rgba = context.getImageData(0, 0, 1920, 1080).data;
    let visible = 0; let outsideGlass = 0;
    for (let y = 0; y < 1080; y++) for (let x = 0; x < 1920; x++) {
      if (rgba[(y * 1920 + x) * 4 + 3] < 10) continue;
      visible++;
      if (y > 868 || !((x >= 1303 && x <= 1483) || (x >= 1517 && x <= 1729))) outsideGlass++;
    }
    return { visible, outsideGlass, size: [rain.width, rain.height] };
  });
  assert.deepEqual(pixels.size, [1920, 1080]);
  assert.ok(pixels.visible > 1000, 'Water has a refracted body and a fine rim.');
  assert.equal(pixels.outsideGlass, 0, 'Water never paints over the wall or window frames.');
  assert.ok((await h.root.locator('.windowlight-plate').evaluateAll(images => images.map(image => [image.naturalWidth, image.naturalHeight])))
    .every(([width, height]) => width === 1920 && height === 1080));
  await h.page.setViewportSize({ width: 720, height: 720 });
  for (const [fit, mask] of [['cover', 'cover'], ['contain', 'contain'], ['fill', '100% 100%']]) {
    await h.page.evaluate(fit => document.body.style.setProperty('--background-fit', fit), fit);
    await h.update({ fit });
    const geometry = await h.root.evaluate(root => [...root.querySelectorAll('.windowlight-plate, canvas')].map(element => {
      const bounds = element.getBoundingClientRect();
      return { fit: getComputedStyle(element).objectFit, bounds: [bounds.x, bounds.y, bounds.width, bounds.height] };
    }));
    assert.ok(geometry.every(item => item.fit === fit && JSON.stringify(item.bounds) === '[0,0,720,720]'));
    assert.equal(await h.root.locator('.windowlight-rain').evaluate(rain => getComputedStyle(rain).maskSize), mask);
  }
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

test('changing the rotation interval during a fade keeps an opaque background underneath', async t => {
  const h = await harness(t);
  await h.update({}, { reducedMotion: true });
  await h.root.evaluate(root => getComputedStyle(root.querySelector('.is-active')).opacity);
  await h.update({}, { reducedMotion: false });
  await h.update({ windowScene: 'sunset', sceneMode: 'auto' }, { reducedMotion: false });
  const halfwayOpacities = () => h.root.locator('.windowlight-plate').evaluateAll(plates => {
    for (const plate of plates) {
      for (const animation of plate.getAnimations()) {
        animation.pause();
        animation.currentTime = 900;
      }
    }
    return plates.map(plate => Number(getComputedStyle(plate).opacity));
  });
  const before = await halfwayOpacities();
  assert.equal(before[0], 1);
  assert.ok(before[1] > 0 && before[1] < 1, 'The incoming scene is midway through its fade.');
  await h.update({ sceneIntervalSeconds: 20 }, { reducedMotion: false });
  const after = await halfwayOpacities();
  assert.equal(after[0], 1, 'The previous scene still covers the transparent canvas.');
  assert.ok(after[1] > 0 && after[1] < 1);
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
