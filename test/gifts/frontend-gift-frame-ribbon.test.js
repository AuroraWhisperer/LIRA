'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const publicRoot = path.resolve(__dirname, '../../public');
const CONTENT_TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.webm': 'video/webm' };
let browser;

test.before(async () => {
  browser = await chromium.launch({ headless: true });
});
test.after(async () => {
  await browser?.close();
});

async function openStage(t) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'lira-ui.test') return route.abort();
    if (url.pathname === '/') {
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><link rel="stylesheet" href="/css/overlays/gift-frame-ribbon.css"><div id="stage" style="position:fixed;inset:0"><div id="giftRibbon"></div></div>',
      });
    }
    const file = path.join(publicRoot, url.pathname);
    if (!file.startsWith(publicRoot) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: CONTENT_TYPES[path.extname(file)] || 'text/plain', body: fs.readFileSync(file) });
  });
  await page.goto('http://lira-ui.test/');
  return page;
}

test('ribbon frame draws text through text nodes, alternates sides and clears every node', async (t) => {
  const page = await openStage(t);
  const { tagLeft, ...firstView } = await page.evaluate(async () => {
    const { createRibbonController } = await import('/js/overlays/gift-frame-ribbon.js');
    window.player = createRibbonController({ root: document.getElementById('giftRibbon') });
    window.playPromise = window.player.play({ userName: '<img src=x>', giftName: '梦幻城堡', num: 12 });
    await new Promise((resolve) => setTimeout(resolve, 900));
    const art = document.querySelector('.ribbon-art');
    return {
      playing: document.getElementById('giftRibbon').classList.contains('is-playing'),
      mirrored: art.getAttribute('transform'),
      tagLeft: document.querySelector('.ribbon-tag-card').style.left,
      user: document.querySelector('.ribbon-tag-user').textContent,
      gift: document.querySelector('.ribbon-tag-name').textContent,
      quantity: document.querySelector('.ribbon-tag-num').textContent,
      images: document.querySelectorAll('.ribbon-tag-card img').length,
      strands: document.querySelectorAll('.ribbon-strand').length,
    };
  });
  assert.deepEqual(firstView, {
    playing: true,
    mirrored: null,
    user: '<img src=x>',
    gift: '梦幻城堡',
    quantity: '×12',
    images: 0,
    strands: 2,
  });

  const ranFinite = await page.evaluate(() => document.getAnimations().every((animation) => {
    const iterations = animation.effect.getTiming().iterations;
    return iterations !== Infinity;
  }));
  assert.equal(ranFinite, true);

  await page.evaluate(() => window.playPromise);
  assert.deepEqual(await page.evaluate(() => ({
    playing: document.getElementById('giftRibbon').classList.contains('is-playing'),
    nodes: document.querySelectorAll('.ribbon-stage, .ribbon-tag').length,
    animations: document.getAnimations().length,
  })), { playing: false, nodes: 0, animations: 0 });

  // 第二次播放镜像到另一侧，文字与礼签位置不随之镜像。
  await page.evaluate(() => { window.playPromise = window.player.play({ userName: '观众B', giftName: '小花花', num: 1 }); });
  await page.waitForSelector('.ribbon-stage');
  assert.deepEqual(await page.evaluate(() => ({
    mirrored: document.querySelector('.ribbon-art').getAttribute('transform'),
    tagLeft: document.querySelector('.ribbon-tag-card').style.left,
  })), { mirrored: 'matrix(-1 0 0 1 1920 0)', tagLeft });
  await page.evaluate(() => window.playPromise);
  await page.evaluate(() => window.player.dispose());
});

test('disposing mid-play releases the stage, the canvas and the pending play', async (t) => {
  const page = await openStage(t);
  const result = await page.evaluate(async () => {
    const { createRibbonController } = await import('/js/overlays/gift-frame-ribbon.js');
    const player = createRibbonController({ root: document.getElementById('giftRibbon') });
    const pending = player.play({ userName: '观众A', giftName: '缎带', num: 3 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    player.dispose();
    await pending;
    return {
      playing: document.getElementById('giftRibbon').classList.contains('is-playing'),
      nodes: document.querySelectorAll('.ribbon-stage, .ribbon-tag').length,
      animations: document.getAnimations().length,
    };
  });
  assert.deepEqual(result, { playing: false, nodes: 0, animations: 0 });
});
