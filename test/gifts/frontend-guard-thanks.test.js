'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const publicRoot = path.resolve(__dirname, '../../public');
const CONTENT_TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.woff2': 'font/woff2' };
let browser;

test.before(async () => {
  browser = await chromium.launch({ headless: true });
});
test.after(async () => {
  await browser?.close();
});

async function openStage(t) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 960, height: 540 } });
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
        body: '<!doctype html><link rel="stylesheet" href="/css/shared/guard-thanks.css"><link rel="stylesheet" href="/css/shared/guard-thanks-aurora.css"><div id="root" style="position:fixed;inset:0;overflow:hidden"></div>',
      });
    }
    const file = path.join(publicRoot, url.pathname);
    if (!file.startsWith(publicRoot) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({
      contentType: CONTENT_TYPES[path.extname(file)] || 'text/plain',
      headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
      body: fs.readFileSync(file),
    });
  });
  await page.goto('http://lira-ui.test/');
  await page.evaluate(async () => {
    window.cards = await import('/js/shared/guard-thanks-card.js');
    window.queues = await import('/js/overlays/gift-effects-guard.js');
  });
  return page;
}

test('classic thanks stops cleanly', async (t) => {
  const page = await openStage(t);
  await page.evaluate(() => {
    window.player = window.cards.createGuardThanksPlayer({ root: document.getElementById('root') });
    window.result = window.player.play({ tier: 'governor', userName: '观众A', months: 3, textMode: 'bilingual', preview: true, style: 'classic' });
  });
  await page.waitForSelector('.gt-card.is-live');
  await page.evaluate(() => window.player.stop());
  assert.equal(await page.evaluate(() => window.result), false);
  assert.equal(await page.locator('.gt-card').count(), 0);
  assert.equal(await page.evaluate(() => document.getElementById('root').classList.contains('is-playing')), false);
});

test('reduced motion completes the bounded timeline and removes every played node', async (t) => {
  const page = await openStage(t);
  await page.clock.install();
  await page.evaluate(() => {
    const player = window.cards.createGuardThanksPlayer({ root: document.getElementById('root') });
    const started = performance.now();
    window.finished = player
      .play({ tier: 'captain', userName: '观众A', textMode: 'zh', style: 'classic' }, { motion: 'reduced', compressed: true })
      .then((result) => ({ result, elapsed: performance.now() - started, cards: document.querySelectorAll('.gt-card').length }));
  });
  await page.waitForSelector('.gt-card.is-live');
  await page.clock.runFor(6000);
  const finished = await page.evaluate(() => window.finished);
  assert.equal(finished.result, true);
  assert.equal(finished.cards, 0);
  assert.ok(finished.elapsed >= 3000 && finished.elapsed < 6000, `elapsed ${finished.elapsed}`);
});

test('overlay queue validates payloads, de-duplicates live events and lets previews repeat', async (t) => {
  const page = await openStage(t);
  const accepted = await page.evaluate(() => {
    const queue = window.queues.createGuardThanksQueue({
      root: document.getElementById('root'),
      resolveMotion: () => 'reduced',
    });
    const live = { type: 'gift:guard-thanks', eventId: 'guard-thanks:7', tier: 'captain', userName: '观众A', months: 1, style: 'classic' };
    const preview = { ...live, eventId: 'guard-thanks:preview', preview: true };
    const results = [
      queue.enqueue(live),
      queue.enqueue(live),
      queue.enqueue({ ...live, eventId: 'guard-thanks:8', tier: 'viewer' }),
      queue.enqueue({ ...live, type: 'gift:frame', eventId: 'guard-thanks:9' }),
      queue.enqueue(preview),
      queue.enqueue(preview),
    ];
    window.queue = queue;
    return results;
  });
  assert.deepEqual(accepted, [true, false, false, false, true, true]);
  await page.waitForSelector('.gt-card');
  await page.evaluate(() => window.queue.dispose());
  assert.equal(await page.locator('.gt-stage').count(), 0);
});

test('aurora style never renders viewer identity and removes its card when finished', async (t) => {
  const page = await openStage(t);
  await page.clock.install();
  const userName = '晚风来信的星河旅人';
  await page.evaluate((userName) => {
    window.player = window.cards.createGuardThanksPlayer({ root: document.getElementById('root') });
    window.result = window.player.play({ tier: 'captain', userName, months: 12, textMode: 'bilingual' });
  }, userName);
  await page.waitForSelector('.gta-card.is-live');
  const view = await page.evaluate(() => {
    const card = document.querySelector('.gta-card');
    return {
      nameNodes: card.querySelectorAll('.gt-name, .gt-avatar, .gt-avatar-image, .gt-avatar-initial').length,
      text: card.textContent,
    };
  });
  assert.equal(view.nameNodes, 0);
  assert.equal(view.text.includes(userName), false, 'viewer name never reaches the aurora card');
  await page.clock.runFor(9000);
  const finished = await page.evaluate(async () => ({
    result: await window.result,
    cards: document.querySelectorAll('.gta-card').length,
  }));
  assert.equal(finished.result, true);
  assert.equal(finished.cards, 0);
});


test('stopping while aurora artwork is pending leaves no delayed card or animation', async (t) => {
  const page = await openStage(t);
  let pendingRoute;
  let received;
  const artworkRequested = new Promise((resolve) => { received = resolve; });
  await page.route('**/img/overlays/guard-thanks/*', (route) => { pendingRoute = route; received(); });
  await page.evaluate(() => {
    window.player = window.cards.createGuardThanksPlayer({ root: document.getElementById('root') });
    window.result = window.player.play({ tier: 'captain', userName: '观众A' });
  });
  await artworkRequested;
  const stopped = await page.evaluate(async () => {
    window.player.stop();
    return { result: await window.result, cards: document.querySelectorAll('.gta-card').length, animations: document.getAnimations().length };
  });
  assert.deepEqual(stopped, { result: false, cards: 0, animations: 0 });
  await pendingRoute.abort();
  assert.equal(await page.locator('.gta-card').count(), 0);
  await page.evaluate(() => window.player.dispose());
});
