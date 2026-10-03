'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const publicRoot = path.resolve(__dirname, '../../public');
const CONTENT_TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
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
        body: '<!doctype html><link rel="stylesheet" href="/css/shared/guard-thanks.css"><div id="root" style="position:fixed;inset:0;overflow:hidden"></div>',
      });
    }
    const file = path.join(publicRoot, url.pathname);
    if (!file.startsWith(publicRoot) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: CONTENT_TYPES[path.extname(file)] || 'text/plain', body: fs.readFileSync(file) });
  });
  await page.goto('http://lira-ui.test/');
  await page.evaluate(async () => {
    window.cards = await import('/js/shared/guard-thanks-card.js');
    window.queues = await import('/js/overlays/gift-effects-guard.js');
  });
  return page;
}

test('governor thanks renders tier copy, sample avatar and fitted name, then stops cleanly', async (t) => {
  const page = await openStage(t);
  const longName = '晚风来信的星河旅人'.repeat(5);
  await page.evaluate((userName) => {
    window.player = window.cards.createGuardThanksPlayer({ root: document.getElementById('root') });
    window.result = window.player.play({ tier: 'governor', userName, months: 3, textMode: 'bilingual', preview: true });
  }, longName);
  await page.waitForSelector('.gt-card.is-live');
  const view = await page.evaluate(() => {
    const card = document.querySelector('.gt-card');
    const name = card.querySelector('.gt-name');
    const fittedSize = name.style.fontSize;
    const fontSize = parseFloat(getComputedStyle(name).fontSize);
    name.style.removeProperty('font-size');
    const baseFontSize = parseFloat(getComputedStyle(name).fontSize);
    name.style.fontSize = fittedSize;
    return {
      tier: card.dataset.tier,
      title: card.querySelector('.gt-ribbon-title').textContent,
      eyebrow: card.querySelector('.gt-eyebrow-text').textContent,
      lead: card.querySelector('.gt-name-lead').textContent,
      tail: card.querySelector('.gt-name-tail').textContent,
      months: card.querySelector('.gt-months').textContent,
      name: name.textContent,
      fontSize,
      baseFontSize,
      avatar: card.querySelector('.gt-avatar-image')?.getAttribute('src'),
      emblem: card.querySelector('.gt-emblem').className,
      playing: document.getElementById('root').classList.contains('is-playing'),
    };
  });
  assert.deepEqual(
    { ...view, name: undefined },
    {
      tier: 'governor',
      title: '总督',
      eyebrow: 'WELCOME ABOARD · GOVERNOR',
      lead: '感谢',
      tail: '开通总督',
      months: '3 个月',
      name: undefined,
      fontSize: view.fontSize,
      baseFontSize: view.baseFontSize,
      avatar: '/img/overlays/danmaku-ranked/governor.webp',
      emblem: 'gt-emblem is-helm',
      playing: true,
    },
  );
  assert.equal(view.name, longName);
  assert.ok(view.fontSize > 0 && view.fontSize < view.baseFontSize, 'long names shrink before ellipsis');
  await page.evaluate(() => window.player.stop());
  assert.equal(await page.evaluate(() => window.result), false);
  assert.equal(await page.locator('.gt-card').count(), 0);
  assert.equal(await page.evaluate(() => document.getElementById('root').classList.contains('is-playing')), false);
});

test('english copy has no Chinese tail and live avatars fall back to the initial on load failure', async (t) => {
  const page = await openStage(t);
  await page.evaluate(() => {
    window.player = window.cards.createGuardThanksPlayer({
      root: document.getElementById('root'),
      resolveAvatarUrl: () => '/img/missing-avatar.webp',
    });
    window.player.play({ tier: 'admiral', userName: 'Aurora', months: 1, textMode: 'en', avatarUrl: 'https://i0.hdslb.com/a.jpg' });
  });
  await page.waitForSelector('.gt-card.is-live');
  const view = await page.evaluate(() => ({
    title: document.querySelector('.gt-ribbon-title').textContent,
    lead: document.querySelector('.gt-name-lead').textContent,
    tail: document.querySelector('.gt-name-tail'),
    months: document.querySelector('.gt-months'),
    initial: document.querySelector('.gt-avatar-initial').textContent,
    image: document.querySelector('.gt-avatar-image'),
  }));
  assert.deepEqual(view, { title: 'ADMIRAL', lead: 'THANK YOU', tail: null, months: null, initial: 'A', image: null });
  await page.evaluate(() => window.player.dispose());
});

test('reduced motion completes the bounded timeline and removes every played node', async (t) => {
  const page = await openStage(t);
  const finished = await page.evaluate(async () => {
    const player = window.cards.createGuardThanksPlayer({ root: document.getElementById('root') });
    const started = performance.now();
    const result = await player.play(
      { tier: 'captain', userName: '观众A', textMode: 'zh' },
      { motion: 'reduced', compressed: true },
    );
    return { result, elapsed: performance.now() - started, cards: document.querySelectorAll('.gt-card').length };
  });
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
    const live = { type: 'gift:guard-thanks', eventId: 'guard-thanks:7', tier: 'captain', userName: '观众A', months: 1 };
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
