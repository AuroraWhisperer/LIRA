'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

const openBrowser = useSharedBrowser();

async function mountRenderer(t) {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html><meta charset="utf-8">
    <link rel="stylesheet" href="/css/shared/now-playing.css">
    <div id="record" style="width:480px;height:220px"></div>` });
  const browser = openBrowser();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await browser.close(); await fixture.close(); assert.deepEqual(errors, []); });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async () => {
    const { createNowPlayingRenderer } = await import('/js/shared/now-playing-renderer.js');
    window.recordRenderer = createNowPlayingRenderer(document.getElementById('record'));
  });
  return page;
}

test('record follows playback without lyrics, preserves its paused angle and renders metadata literally', async t => {
  const page = await mountRenderer(t);
  const state = { source: 'netease-client', trackTitle: '<b>歌曲</b>（Live）', artists: ['歌手甲', '歌手乙'], playing: true };
  await page.evaluate(state => window.recordRenderer.updateState(state), state);
  await page.waitForFunction(() => document.querySelector('.now-playing-disc').getAnimations()[0]?.playState === 'running');
  assert.equal(await page.locator('.now-playing-title').innerText(), state.trackTitle);
  assert.equal(await page.locator('.now-playing-title b').count(), 0);
  assert.equal(await page.locator('.now-playing-artist').innerText(), '歌手甲 / 歌手乙');
  assert.equal(await page.locator('.now-playing-title').evaluate(node => getComputedStyle(node).transform), 'none');

  const paused = await page.evaluate(async state => {
    const disc = document.querySelector('.now-playing-disc');
    window.recordAnimation = disc.getAnimations()[0];
    window.recordAnimation.currentTime = 5300;
    window.recordRenderer.updateState({ ...state, playing: false });
    const playState = getComputedStyle(disc).animationPlayState;
    await window.recordAnimation.ready;
    return { time: window.recordAnimation.currentTime, transform: getComputedStyle(disc).transform,
      playState };
  }, state);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const held = await page.locator('.now-playing-disc').evaluate(disc => ({
    time: disc.getAnimations()[0].currentTime, transform: getComputedStyle(disc).transform,
    playState: getComputedStyle(disc).animationPlayState,
  }));
  assert.equal(paused.playState, 'paused');
  assert.equal(held.time, paused.time);
  assert.equal(held.transform, paused.transform);
  await page.evaluate(state => window.recordRenderer.updateState(state), state);
  assert.equal(await page.locator('.now-playing-disc').evaluate(disc => disc.getAnimations()[0] === window.recordAnimation), true);

  await page.evaluate(() => window.recordRenderer.updateConfig({ nowPlayingShowRecord: false, nowPlayingShowArtist: false }));
  assert.equal(await page.locator('.now-playing-visual').isVisible(), false);
  assert.equal(await page.locator('.now-playing-title').isVisible(), true);
  assert.equal(await page.locator('.now-playing-artist').isVisible(), false);
  await page.evaluate(state => {
    window.recordRenderer.updateConfig({ nowPlayingHideOnPause: true });
    window.recordRenderer.updateState({ ...state, playing: false });
  }, state);
  assert.equal(await page.locator('.now-playing').isVisible(), false);
  await page.evaluate(() => {
    window.recordRenderer.updateConfig({ nowPlayingHideWhenEmpty: false });
    window.recordRenderer.updateState(null);
  });
  assert.equal(await page.locator('.now-playing-title').innerText(), '等待播放');
  assert.equal(await page.locator('.now-playing-artist').isVisible(), false);
  await page.evaluate(() => { window.recordRenderer.dispose(); window.recordRenderer.dispose(); });
  assert.equal(await page.locator('.now-playing').count(), 0);
});

test('track changes clear old artwork immediately and delayed image loads cannot replace the current cover', async t => {
  const page = await mountRenderer(t);
  const image = fs.readFileSync(path.resolve(__dirname, '../../public/img/overlays/gift-feed/flower.webp'));
  let firstRequest;
  const firstRequested = new Promise(resolve => { firstRequest = resolve; });
  let pending;
  await page.route('https://covers.example/**', async route => {
    if (route.request().url().endsWith('/slow.webp')) { pending = route; firstRequest(); }
    else await route.fulfill({ contentType: 'image/webp', body: image });
  });
  const track = { source: 'internal', trackTitle: '第一首', artists: ['歌手'], playing: true };
  await page.evaluate(track => window.recordRenderer.updateState({ ...track, coverUrl: 'https://covers.example/first.webp' }), track);
  await page.locator('.now-playing-cover').waitFor({ state: 'visible' });
  await page.evaluate(track => window.recordRenderer.updateState({ ...track, trackTitle: '第二首', coverUrl: 'https://covers.example/slow.webp' }), track);
  await firstRequested;
  assert.equal(await page.locator('.now-playing-cover').count(), 0);
  await page.evaluate(track => window.recordRenderer.updateState({ ...track, trackTitle: '第三首', coverUrl: 'https://covers.example/current.webp' }), track);
  await page.locator('.now-playing-cover').waitFor({ state: 'visible' });
  await pending.fulfill({ contentType: 'image/webp', body: image });
  assert.equal(await page.locator('.now-playing-cover').getAttribute('src'), 'https://covers.example/current.webp');
  assert.equal(await page.locator('.now-playing-title').innerText(), '第三首');
  await page.evaluate(track => window.recordRenderer.updateState({ ...track, coverUrl: '' }), track);
  assert.equal(await page.locator('.now-playing-cover').count(), 0);
  assert.equal(await page.locator('.now-playing-disc').isVisible(), true);
});

test('record and text widgets keep separate content and the record fills its resized box', async t => {
  const page = await mountRenderer(t);
  const state = { trackTitle: '独立歌名', artists: ['独立歌手'], playing: true, coverUrl: 'https://covers.example/unused.webp' };
  const coverRequests = [];
  await page.route('https://covers.example/**', route => { coverRequests.push(route.request().url()); return route.abort(); });
  await page.evaluate(async state => {
    const { createNowPlayingRenderer } = await import('/js/shared/now-playing-renderer.js');
    const text = document.createElement('div');
    text.id = 'metadata'; text.style.cssText = 'width:360px;height:160px';
    document.body.append(text);
    window.textRenderer = createNowPlayingRenderer(text, { part: 'text' });
    window.textRenderer.updateState(state);
    window.recordRenderer.updateConfig({ nowPlayingPart: 'record' });
    window.recordRenderer.updateState({ ...state, coverUrl: '' });
    document.getElementById('record').style.cssText = 'width:240px;height:240px';
  }, state);
  assert.equal(await page.locator('#record .now-playing-copy').isVisible(), false);
  assert.equal(await page.locator('#metadata .now-playing-visual').isVisible(), false);
  assert.equal(await page.locator('#metadata .now-playing-title').innerText(), state.trackTitle);
  assert.equal(await page.locator('#metadata .now-playing-artist').innerText(), state.artists[0]);
  assert.equal(Math.round((await page.locator('#record .now-playing-visual').boundingBox()).width), 240);
  await page.locator('#record').evaluate(root => { root.style.width = '180px'; root.style.height = '150px'; });
  assert.equal(Math.round((await page.locator('#record .now-playing-visual').boundingBox()).width), 150);
  assert.deepEqual(coverRequests, []);
  await page.evaluate(() => { window.textRenderer.dispose(); window.recordRenderer.dispose(); });
});
