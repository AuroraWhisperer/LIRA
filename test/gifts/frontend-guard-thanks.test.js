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

test('governor thanks renders tier copy, sample avatar and fitted name, then stops cleanly', async (t) => {
  const page = await openStage(t);
  const longName = '晚风来信的星河旅人'.repeat(5);
  await page.evaluate((userName) => {
    window.player = window.cards.createGuardThanksPlayer({ root: document.getElementById('root') });
    window.result = window.player.play({ tier: 'governor', userName, months: 3, textMode: 'bilingual', preview: true, style: 'classic' });
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
    window.player.play({ tier: 'admiral', userName: 'Aurora', months: 1, textMode: 'en', avatarUrl: 'https://i0.hdslb.com/a.jpg', style: 'classic' });
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
      { tier: 'captain', userName: '观众A', textMode: 'zh', style: 'classic' },
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

test('aurora style is the default and never renders viewer identity', async (t) => {
  const page = await openStage(t);
  const artworkRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/img/overlays/guard-thanks/')) artworkRequests.push(request.url());
  });
  const userName = '晚风来信的星河旅人';
  const started = await page.evaluate(() => {
    window.player = window.cards.createGuardThanksPlayer({ root: document.getElementById('root') });
    window.startedAt = performance.now();
    window.result = window.player.play({ tier: 'captain', userName: '晚风来信的星河旅人', months: 12, textMode: 'bilingual' });
    return document.querySelectorAll('.gt-card').length;
  });
  assert.equal(started, 0, 'no classic card is mounted for the aurora default');
  await page.waitForSelector('.gta-card.is-live');
  const view = await page.evaluate(() => {
    const card = document.querySelector('.gta-card');
    return {
      tier: card.dataset.tier,
      lang: card.dataset.lang,
      material: card.dataset.material,
      title: card.querySelector('.gta-title').textContent,
      eyebrow: card.querySelector('.gta-eyebrow-text').textContent,
      months: card.querySelector('.gta-months').textContent,
      artwork: card.querySelector('.gta-artwork').getAttribute('src'),
      decoded: card.querySelector('.gta-sigil').classList.contains('has-artwork'),
      font: card.classList.contains('has-title-font'),
      nameNodes: card.querySelectorAll('.gt-name, .gt-avatar, .gt-avatar-image, .gt-avatar-initial, .gt-medallion, .gt-ribbon, .gt-name-pill').length,
      text: card.textContent,
    };
  });
  assert.deepEqual({ ...view, text: undefined }, {
    tier: 'captain',
    lang: 'zh',
    material: 'blue-pearl',
    title: '舰长',
    eyebrow: 'WELCOME ABOARD · CAPTAIN',
    months: '12 个月',
    artwork: '/img/overlays/guard-thanks/captain-pearl-v1.webp',
    decoded: true,
    font: true,
    nameNodes: 0,
    text: undefined,
  });
  assert.equal(view.text.includes(userName), false, 'viewer name never reaches the aurora card');
  const finished = await page.evaluate(async () => ({
    result: await window.result,
    elapsed: performance.now() - window.startedAt,
    cards: document.querySelectorAll('.gta-card').length,
  }));
  assert.equal(finished.result, true);
  assert.equal(finished.cards, 0);
  assert.ok(finished.elapsed >= 6800, `aurora captain must run at least 6.8s, got ${finished.elapsed}`);
  assert.equal(artworkRequests.length, 1, 'artwork and its reflection mask share one request');
});

test('aurora tiers use distinct pearl artwork and restrained ornament', async (t) => {
  const page = await openStage(t);
  const views = [];
  for (const tier of ['captain', 'admiral', 'governor']) {
    await page.evaluate((tier) => {
      window.player = window.cards.createGuardThanksPlayer({ root: document.getElementById('root') });
      window.result = window.player.play({ tier, userName: '观众A', textMode: 'zh' }, { motion: 'reduced' });
    }, tier);
    await page.waitForSelector('.gta-card.is-live');
    views.push(await page.evaluate(() => {
      const card = document.querySelector('.gta-card');
      return {
        material: card.dataset.material,
        hue: getComputedStyle(card).getPropertyValue('--gta-hue').trim(),
        artwork: card.querySelector('.gta-artwork').getAttribute('src'),
        decoded: card.querySelector('.gta-sigil').classList.contains('has-artwork'),
        orbits: card.querySelectorAll('.gta-orbit-path').length,
        motes: card.querySelectorAll('.gta-mote').length,
        regaliaStars: card.querySelectorAll('.gta-regalia-star').length,
        crownRays: card.querySelectorAll('.gta-crown-ray').length,
        ripples: card.querySelectorAll('.gta-ripple').length,
        hiddenLightEffects: Array.from(card.querySelectorAll('.gta-mote, .gta-glint, .gta-reflection, .gta-orbit-trail, .gta-regalia-line, .gta-regalia-star, .gta-crown-ray, .gta-ripple'))
          .every((node) => Number(getComputedStyle(node).opacity) === 0),
        animations: document.getAnimations().length,
      };
    }));
    await page.evaluate(async () => {
      window.player.stop();
      await window.result;
      window.player.dispose();
    });
  }
  assert.deepEqual(views, [
    { material: 'blue-pearl', hue: '54, 145, 243', artwork: '/img/overlays/guard-thanks/captain-pearl-v1.webp', decoded: true, orbits: 1, motes: 18, regaliaStars: 0, crownRays: 0, ripples: 0, hiddenLightEffects: true, animations: 2 },
    { material: 'violet-pearl', hue: '151, 84, 225', artwork: '/img/overlays/guard-thanks/admiral-pearl-v1.webp', decoded: true, orbits: 3, motes: 32, regaliaStars: 8, crownRays: 0, ripples: 0, hiddenLightEffects: true, animations: 2 },
    { material: 'ruby-pearl', hue: '219, 51, 80', artwork: '/img/overlays/guard-thanks/governor-pearl-v1.webp', decoded: true, orbits: 5, motes: 50, regaliaStars: 12, crownRays: 9, ripples: 2, hiddenLightEffects: true, animations: 2 },
  ]);
});

test('aurora stages its entrance and extends every tier by one second, including queued playback', async (t) => {
  const page = await openStage(t);
  const expectedDurations = { captain: [6800, 5900], admiral: [7400, 6380], governor: [8200, 7000] };
  for (const [tier, durations] of Object.entries(expectedDurations)) {
    for (const compressed of [false, true]) {
      await page.evaluate(({ tier, compressed }) => {
        window.player = window.cards.createGuardThanksPlayer({ root: document.getElementById('root') });
        window.result = window.player.play({ tier, userName: '预览观众', style: 'aurora' }, { compressed });
      }, { tier, compressed });
      await page.waitForSelector('.gta-card.is-live');
      const view = await page.evaluate(() => {
        const animations = document.getAnimations();
        const exit = animations.find((animation) => animation.effect.target.classList.contains('gta-card')).effect.getTiming();
        const frames = [400, 1100, 2000, 3500].map((time) => {
          animations.forEach((animation) => { animation.pause(); animation.currentTime = time; });
          const opacity = (selector) => Number(getComputedStyle(document.querySelector(selector)).opacity);
          return {
            orbit: opacity('.gta-card > .gta-orbit:not(.gta-regalia)'),
            sigil: opacity('.gta-sigil'),
            caption: opacity('.gta-caption'),
            motes: Array.from(document.querySelectorAll('.gta-mote')).filter((node) => Number(getComputedStyle(node).opacity) > 0).length,
            totalMotes: document.querySelectorAll('.gta-mote').length,
          };
        });
        return { duration: exit.delay + exit.duration, frames };
      });
      assert.equal(view.duration, durations[Number(compressed)], `${tier}: bounded duration includes the extra second`);
      assert.ok(view.frames[0].orbit > 0, `${tier}: arcs lead the entrance`);
      assert.equal(view.frames[0].sigil, 0, `${tier}: emblem waits for its turn`);
      assert.equal(view.frames[0].caption, 0);
      assert.equal(view.frames[0].motes, 0);
      assert.ok(view.frames[1].sigil > 0.5, `${tier}: emblem appears before the caption`);
      assert.equal(view.frames[1].caption, 0);
      assert.ok(view.frames[2].caption > 0.9);
      assert.ok(view.frames[2].motes > 0 && view.frames[2].motes < view.frames[2].totalMotes, `${tier}: particles enter in batches`);
      assert.ok(view.frames[3].motes > view.frames[2].motes, `${tier}: later batches join the first`);
      await page.evaluate(async () => { window.player.stop(); await window.result; window.player.dispose(); });
      assert.equal(await page.locator('.gta-card').count(), 0);
      assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    }
  }
});

test('aurora fits native 1440p with still high-resolution emblems and moving light', async (t) => {
  const page = await openStage(t);
  await page.setViewportSize({ width: 2560, height: 1440 });
  const frames = [];
  for (const tier of ['captain', 'admiral', 'governor']) {
    await page.evaluate((tier) => {
      window.player = window.cards.createGuardThanksPlayer({ root: document.getElementById('root') });
      window.result = window.player.play({ tier, userName: '预览观众', months: 12, textMode: 'en', style: 'aurora' });
    }, tier);
    await page.waitForSelector('.gta-card.is-live');
    frames.push(...await page.evaluate(() => {
      const animations = document.getAnimations();
      const exit = animations.find((animation) => animation.effect.target.classList.contains('gta-card'));
      const exitAt = exit.effect.getTiming().delay;
      const card = document.querySelector('.gta-card');
      const frames = [];
      for (const time of [400, 1100, 2000, 3200, 4900, exitAt + 300]) {
        animations.forEach((animation) => {
          animation.pause();
          animation.currentTime = time;
        });
        const title = card.querySelector('.gta-title');
        const titleRect = title.getBoundingClientRect();
        const stageRect = card.getBoundingClientRect();
        const artwork = card.querySelector('.gta-artwork');
        const artworkRect = artwork.getBoundingClientRect();
        frames.push({
          tier: card.dataset.tier,
          time,
          light: Math.max(...Array.from(card.querySelectorAll('.gta-orbit-path'), (node) => Number(getComputedStyle(node).opacity))),
          reflection: getComputedStyle(card.querySelector('.gta-reflection')).backgroundPosition,
          reflectionMask: getComputedStyle(card.querySelector('.gta-reflection')).maskImage,
          trail: getComputedStyle(card.querySelector('.gta-trail-head')).strokeDashoffset,
          artworkBounds: { x: artworkRect.x, y: artworkRect.y, width: artworkRect.width, height: artworkRect.height },
          artworkHasResolution: artwork.naturalWidth >= artworkRect.width * devicePixelRatio && artwork.naturalHeight >= artworkRect.height * devicePixelRatio,
          contentFits: [artworkRect, card.querySelector('.gta-caption').getBoundingClientRect()].every((rect) =>
            rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight),
          rays: getComputedStyle(card.querySelector('.gta-rays')).transform,
          filters: ['.gta-caption', '.gta-title-row', '.gta-eyebrow', '.gta-footer'].map((selector) => getComputedStyle(card.querySelector(selector)).filter),
          textOpacity: Math.min(...Array.from(title.children, (node) => Number(getComputedStyle(node).opacity))),
          fits: titleRect.left >= stageRect.left && titleRect.right <= stageRect.right,
        });
      }
      return frames;
    }));
    await page.evaluate(async () => {
      window.player.stop();
      await window.result;
      window.player.dispose();
    });
  }
  for (const frame of frames) {
    const label = `${frame.tier} at ${frame.time}ms`;
    assert.ok(frame.light <= 0.25, `${label}: orbital light stays restrained`);
    assert.deepEqual(frame.filters, ['none', 'none', 'none', 'none'], `${label}: text is never blurred`);
    assert.equal(frame.fits, true, `${label}: English title fits within the stage`);
    assert.equal(frame.contentFits, true, `${label}: artwork and text fit within the 16:9 output`);
    assert.equal(frame.artworkHasResolution, true, `${label}: artwork does not need pixel upscaling at 1440p`);
    assert.ok(frame.reflectionMask.includes(`/img/overlays/guard-thanks/${frame.tier}-pearl-v1.webp`), `${label}: reflection is clipped by the actual artwork`);
    if (frame.time >= 3200) assert.equal(frame.textOpacity, 1, `${label}: every letter is readable by the hold`);
  }
  for (const tier of ['captain', 'admiral', 'governor']) {
    const tierFrames = frames.filter((frame) => frame.tier === tier);
    for (const frame of tierFrames) {
      assert.deepEqual(frame.artworkBounds, tierFrames[0].artworkBounds, `${tier} at ${frame.time}ms: emblem stays fixed through entrance, hold and exit`);
    }
    const early = frames.find((frame) => frame.tier === tier && frame.time === 3200);
    const late = frames.find((frame) => frame.tier === tier && frame.time === 4900);
    for (const effect of ['reflection', 'trail', 'rays']) {
      assert.notEqual(early[effect], late[effect], `${tier}: ${effect} keeps moving through the hold`);
    }
  }
});

test('aurora falls back to a vector emblem if the local artwork cannot load', async (t) => {
  const page = await openStage(t);
  await page.route('**/img/overlays/guard-thanks/*', (route) => route.fulfill({ status: 404, body: '' }));
  await page.evaluate(() => {
    window.player = window.cards.createGuardThanksPlayer({ root: document.getElementById('root') });
    window.result = window.player.play({ tier: 'governor', userName: '观众A', textMode: 'zh' });
  });
  await page.waitForSelector('.gta-card.is-live');
  assert.equal(await page.locator('.gta-sigil.has-artwork').count(), 0);
  assert.equal(await page.locator('.gta-sigil-fallback').isVisible(), true);
  assert.equal(await page.locator('.gta-title').textContent(), '总督');
  await page.evaluate(async () => { window.player.stop(); await window.result; window.player.dispose(); });
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

test('switching from classic particles to reduced aurora clears the old canvas', async (t) => {
  const page = await openStage(t);
  await page.evaluate(() => {
    window.player = window.cards.createGuardThanksPlayer({ root: document.getElementById('root') });
    window.player.play({ tier: 'governor', userName: '观众A', style: 'classic', preview: true });
  });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.gt-particles');
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0);
  });
  await page.evaluate(() => {
    window.result = window.player.play({ tier: 'captain', userName: '观众A', style: 'aurora' }, { motion: 'reduced' });
  });
  await page.waitForSelector('.gta-card.is-live');
  const empty = await page.evaluate(() => {
    const canvas = document.querySelector('.gt-particles');
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.every((value) => value === 0);
  });
  assert.equal(empty, true);
  assert.equal(await page.locator('.gt-card').count(), 0);
  await page.evaluate(async () => { window.player.stop(); await window.result; window.player.dispose(); });
});
