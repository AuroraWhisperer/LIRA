'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

const openBrowser = useSharedBrowser();
const publicRoot = path.resolve(__dirname, '../../public');
const appearanceHtml = fs.readFileSync(path.join(publicRoot, 'pages/admin/playback/appearance.html'), 'utf8');
const playerHtml = fs.readFileSync(path.join(publicRoot, 'pages/admin/playback/fullscreen.html'), 'utf8');

test('failed fullscreen artwork is not retried by progress renders and a changed URL can recover', async t => {
  const browser = openBrowser();
  t.after(() => browser.close());
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html><meta charset="utf-8">${playerHtml}` });
  t.after(() => fixture.close());
  const page = await browser.newPage();
  let failedRequests = 0;
  await page.route('**/unavailable-cover.png', route => {
    failedRequests++;
    return route.fulfill({ status: 404, body: '' });
  });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async () => {
    const { FullscreenPlayer } = await import('/js/playback/ui/fullscreen.js');
    window.coverPlayer = new FullscreenPlayer();
    window.coverPlayer.init();
    window.coverTrack = { title: '封面测试', artists: [], coverUrl: new URL('/unavailable-cover.png', location.href).href };
    window.coverPlayer.render(window.coverTrack, { paused: false });
  });
  await page.waitForFunction(() => !document.querySelector('#playerFsArt img'));
  await page.evaluate(() => {
    for (let index = 0; index < 20; index++) window.coverPlayer.render(window.coverTrack, { paused: false });
  });
  await page.waitForFunction(() => !document.querySelector('#playerFsArt img'));
  assert.equal(failedRequests, 1);
  const recovered = await page.evaluate(async () => {
    window.coverTrack.coverUrl = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
    window.coverPlayer.render(window.coverTrack, { paused: false });
    const image = document.querySelector('#playerFsArt img');
    await image.decode();
    window.coverPlayer.render(window.coverTrack, { paused: false });
    return { sameImage: image === document.querySelector('#playerFsArt img'),
      hasImage: document.getElementById('playerFsArt').classList.contains('has-image') };
  });
  assert.equal(recovered.sameImage, true);
  assert.equal(recovered.hasImage, true);
});

test('player appearance preview follows playback while respecting rotation and cover settings', async t => {
  const browser = openBrowser();
  t.after(() => browser.close());
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html><meta charset="utf-8">
    <link rel="stylesheet" href="/css/styles-base.css">
    <link rel="stylesheet" href="/css/styles-admin.css">
    <link rel="stylesheet" href="/css/styles-playback.css">
    <main class="app-shell">${appearanceHtml}${playerHtml}</main>` });
  t.after(() => fixture.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async () => {
    document.getElementById('playerAppearance').hidden = false;
    const { FullscreenPlayer } = await import('/js/playback/ui/fullscreen.js');
    window.appearancePlayer = new FullscreenPlayer();
    window.appearancePlayer.init();
  });
  await page.locator('[name="playerAppearanceStyle"][value="vinyl-arm"]').check();

  async function visualState() {
    return page.evaluate(() => {
      const read = root => {
        const disc = root.querySelector('.player-fs-vinyl-disc');
        const style = getComputedStyle(disc);
        const arm = root.querySelector('.player-fs-tonearm');
        return { animation: style.animationName, playState: style.animationPlayState,
          armPlaying: arm.classList.contains('playing'), armDisplay: getComputedStyle(arm).display };
      };
      return { player: read(document.getElementById('playerFullscreen')),
        preview: read(document.querySelector('.player-appearance-canvas')) };
    });
  }

  assert.equal((await visualState()).preview.animation, 'none');
  await page.evaluate(() => window.appearancePlayer.updateVinylAnimation(true));
  let state = await visualState();
  assert.notEqual(state.player.animation, 'none');
  assert.deepEqual(state.preview, state.player);
  assert.equal(state.preview.playState, 'running');
  assert.equal(state.preview.armPlaying, true);

  await page.getByLabel('播放时旋转唱片').uncheck();
  state = await visualState();
  assert.deepEqual(state.preview, state.player);
  assert.equal(state.preview.playState, 'paused');
  await page.getByLabel('播放时旋转唱片').check();
  assert.equal((await visualState()).preview.playState, 'running');

  await page.evaluate(() => window.appearancePlayer.updateVinylAnimation(false));
  state = await visualState();
  assert.deepEqual(state.preview, state.player);
  assert.equal(state.preview.playState, 'paused');
  assert.equal(state.preview.armPlaying, false);

  await page.locator('[name="playerAppearanceStyle"][value="cover"]').check();
  await page.evaluate(() => window.appearancePlayer.updateVinylAnimation(true));
  state = await visualState();
  assert.deepEqual(state.preview, state.player);
  assert.equal(state.preview.animation, 'none');
  assert.equal(state.preview.armDisplay, 'none');
  assert.deepEqual(errors, []);
});
