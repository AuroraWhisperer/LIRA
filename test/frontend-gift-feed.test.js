'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createUiFixture } = require('./helpers/ui-edit-state-fixture');

const fixture = createUiFixture();

// Speed 31 advances one row in two seconds on the 5–0.1 second scale.
async function openFeed(t, { count = 5, scrollSpeed = 31 } = {}) {
  const page = await fixture(t, 'gift-feed');
  await page.setContent('<main id="giftFeedViewport"><div id="giftFeedStage" class="gift-banner-stage"></div></main><p id="giftFeedStatus"></p>');
  for (const file of ['shared/gift-banner.css', 'overlays/gift-feed.css']) {
    await page.addStyleTag({ content: fs.readFileSync(path.resolve('public/css', file), 'utf8') });
  }
  await page.evaluate(async ({ count, scrollSpeed }) => {
    window.feedConfig = { palette: 'bilibili-four', thresholds: [3000, 10000, 100000], visibleRows: 3, scrollSpeed };
    window.feedItems = Array.from({ length: count }, (_, index) => ({ eventId: String(index),
      gift: { giftId: 'sample', giftName: '礼物', userName: `观众${index}`, unitPrice: 2, num: 1 } }));
    window.feedRevision = 'first';
    window.feedProfiles = [];
    window.feedScans = 0;
    window.feedRequests = [];
    window.feedFrames = new Map();
    let frameId = 0;
    window.requestAnimationFrame = (callback) => { window.feedFrames.set(++frameId, callback); return frameId; };
    window.cancelAnimationFrame = (id) => window.feedFrames.delete(id);
    window.stepFeedFrame = (time) => {
      const callbacks = [...window.feedFrames.values()];
      window.feedFrames.clear();
      for (const callback of callbacks) callback(time);
    };
    window.fetch = async (url) => {
      window.feedRequests.push(url);
      let data;
      if (url === '/api/gifts/display-settings') data = window.feedConfig;
      else if (url.startsWith('/api/gifts/card-profiles?')) data = {
        viewRevision: window.feedRevision, day: new Date(Date.now() + 28800000).toISOString().slice(0, 10), items: window.feedProfiles, partial: false,
      };
      else if (url === '/api/overtime/gifts/catalog') data = { gifts: [] };
      else if (url.startsWith('/api/gifts/history?')) {
        window.feedScans += 1;
        data = { items: window.feedItems, viewRevision: window.feedRevision, nextCursor: null, partial: false };
      } else throw new Error(`Unexpected fetch: ${url}`);
      return { ok: true, json: async () => ({ ok: true, data: structuredClone(data) }) };
    };
    await import('/js/overlays/gift-feed.js');
  }, { count, scrollSpeed });
  await page.waitForFunction(() => window.feedScans === 1, {}, { polling: 20 });
  return page;
}

async function frame(page, time) {
  return page.evaluate((timestamp) => {
    window.stepFeedFrame(timestamp);
    const stage = document.getElementById('giftFeedStage');
    return { ids: [...stage.children].map((row) => row.dataset.eventId),
      offset: new DOMMatrixReadOnly(getComputedStyle(stage).transform).m42,
      frames: window.feedFrames.size };
  }, time);
}

async function refreshFeed(page, reason = 'settings') {
  const scans = await page.evaluate((reason) => {
    window.socketOptions.onMessage({ type: 'snapshot', reason });
    return window.feedScans;
  }, reason);
  await page.waitForFunction((previous) => window.feedScans > previous, scans, { polling: 20 });
}

async function observeFeed(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('#giftFeedStage img')].every((image) => image.complete));
  await page.evaluate(() => {
    const stage = document.getElementById('giftFeedStage');
    window.savedRows = [...stage.children];
    window.feedMutations = [];
    window.feedObserver = new MutationObserver((records) => window.feedMutations.push(...records));
    window.feedObserver.observe(stage, { childList: true, subtree: true, attributes: true, characterData: true });
    window.feedRequests = [];
  });
}

test('new gift inserts only its card and repeated gift notifications leave the displayed DOM untouched', async (t) => {
  const page = await openFeed(t, { count: 2 });
  await observeFeed(page);
  await page.evaluate(() => { window.feedItems.push({ ...window.feedItems[0], eventId: 'new' }); });
  await refreshFeed(page, 'bilibili:gift');
  assert.deepEqual(await page.evaluate(() => ({
    reused: window.savedRows.every((row, index) => row === document.getElementById('giftFeedStage').children[index]),
    inserted: window.feedMutations.filter((record) => record.target.id === 'giftFeedStage')
      .flatMap((record) => [...record.addedNodes].map((node) => node.dataset.eventId)),
    removed: window.feedMutations.reduce((count, record) => count + record.removedNodes.length, 0),
    resourceRequests: window.feedRequests.filter((url) => /display-settings|catalog/.test(url)),
  })), { reused: true, inserted: ['new'], removed: 0, resourceRequests: [] });
  await page.waitForFunction(() => [...document.querySelectorAll('#giftFeedStage img')].every((image) => image.complete));
  await page.evaluate(() => { window.feedMutations = []; });
  await refreshFeed(page, 'bilibili:gift');
  assert.equal(await page.evaluate(() => window.feedMutations.length), 0);
});

test('a new gift in an existing sender group patches quantity and color without replacing images or measuring text', async (t) => {
  const page = await openFeed(t, { count: 1 });
  await page.evaluate(() => {
    const day = new Date(Date.now() + 28800000).toISOString().slice(0, 10);
    Object.assign(window.feedItems[0].gift, { createdAt: `${day}T01:00:00Z`, unitPrice: 20 });
    window.feedProfiles = [{ eventId: '0', senderId: '100', userName: '观众0', avatarUrl: null,
      guardLevel: 3, createdAt: window.feedItems[0].gift.createdAt }];
  });
  await refreshFeed(page);
  await observeFeed(page);
  await page.evaluate(() => {
    const row = document.getElementById('giftFeedStage').firstElementChild;
    window.savedImages = [...row.querySelectorAll('img')];
    window.textMeasurements = 0;
    const measure = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this.matches('.gift-banner-name, .gift-banner-gift')) window.textMeasurements += 1;
      return measure.call(this);
    };
    window.feedItems.push({ ...window.feedItems[0], eventId: 'new' });
    window.feedProfiles.push({ ...window.feedProfiles[0], eventId: 'new' });
  });
  await refreshFeed(page, 'bilibili:gift');
  assert.deepEqual(await page.evaluate(() => {
    const row = document.getElementById('giftFeedStage').firstElementChild;
    return { sameRow: row === window.savedRows[0],
      sameImages: window.savedImages.every((image, index) => image === row.querySelectorAll('img')[index]),
      count: row.querySelector('.gift-banner-count').textContent,
      color: row.style.getPropertyValue('--gift-start'), measurements: window.textMeasurements,
      childChanges: window.feedMutations.filter((record) => record.type === 'childList').length };
  }), { sameRow: true, sameImages: true, count: '×2', color: '#8F58EDF2', measurements: 0, childChanges: 0 });
});

test('one scrolling step removes the outgoing row and inserts only the new buffer row', async (t) => {
  const page = await openFeed(t);
  await frame(page, 0);
  await observeFeed(page);
  await frame(page, 2000);
  assert.deepEqual(await page.evaluate(() => {
    const changes = window.feedMutations.filter((record) => record.target.id === 'giftFeedStage' && record.type === 'childList');
    return { added: changes.flatMap((record) => [...record.addedNodes].map((node) => node.dataset.eventId)),
      removed: changes.flatMap((record) => [...record.removedNodes].map((node) => node.dataset.eventId)),
      reused: window.savedRows.slice(1).every((row, index) => row === document.getElementById('giftFeedStage').children[index]) };
  }), { added: ['4'], removed: ['0'], reused: true });
});

test('a settings change arriving during a gift refresh is applied in the next batch', async (t) => {
  const page = await openFeed(t, { count: 1 });
  await observeFeed(page);
  await page.evaluate(() => {
    const fetch = window.fetch;
    window.deferHistory = true;
    window.fetch = async (url) => {
      if (window.deferHistory && url.startsWith('/api/gifts/history?')) {
        window.deferHistory = false;
        await new Promise((resolve) => { window.resumeHistory = resolve; });
      }
      return fetch(url);
    };
    window.socketOptions.onMessage({ type: 'snapshot', reason: 'bilibili:gift' });
  });
  await page.waitForFunction(() => typeof window.resumeHistory === 'function');
  await page.evaluate(() => {
    window.feedConfig.thresholds = [100, 300, 500];
    window.socketOptions.onMessage({ type: 'snapshot', reason: 'settings' });
    window.resumeHistory();
  });
  await page.waitForFunction(() => window.feedScans === 3);
  assert.deepEqual(await page.evaluate(() => ({
    sameRow: document.getElementById('giftFeedStage').firstElementChild === window.savedRows[0],
    color: window.savedRows[0].style.getPropertyValue('--gift-start'),
    resources: window.feedRequests.filter((url) => /display-settings|catalog/.test(url)),
  })), { sameRow: true, color: '#8F58EDF2', resources: ['/api/gifts/display-settings'] });
});

test('a static card retries a failed avatar at refresh and keeps a successfully loaded avatar', async (t) => {
  const page = await openFeed(t, { count: 1 });
  let fail = true;
  let requests = 0;
  await page.route('**/api/bilibili/avatar?*', (route) => {
    requests += 1;
    return fail ? route.fulfill({ status: 502, body: 'unavailable' })
      : route.fulfill({ contentType: 'image/png', body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFeYAAAAASUVORK5CYII=', 'base64') });
  });
  await page.evaluate(() => { window.feedItems[0].gift.avatarUrl = 'https://i0.hdslb.com/bfs/face/synthetic.webp'; });
  await refreshFeed(page);
  await page.waitForFunction(() => document.querySelector('.gift-banner-avatar').getAttribute('src') === '/img/gift-avatar-placeholder.svg');
  await page.evaluate(() => {
    window.failedAvatar = document.querySelector('.gift-banner-avatar');
    window.failedAvatarRow = document.querySelector('.gift-banner');
  });
  fail = false;
  await refreshFeed(page);
  await page.waitForFunction(() => {
    const avatar = document.querySelector('.gift-banner-avatar');
    return avatar.getAttribute('src').startsWith('/api/bilibili/avatar?') && avatar.complete && avatar.naturalWidth > 0;
  }, {}, { timeout: 1500 });
  assert.equal(requests, 2);
  assert.equal(await page.evaluate(() => window.failedAvatar === document.querySelector('.gift-banner-avatar') &&
    window.failedAvatarRow === document.querySelector('.gift-banner')), true);
  await refreshFeed(page);
  assert.equal(requests, 2);
});

test('feed moves continuously, reuses rows and joins the last gift directly to the first', async (t) => {
  const page = await openFeed(t);
  assert.deepEqual(await frame(page, 0), { ids: ['0', '1', '2', '3'], offset: 0, frames: 1 });
  await page.evaluate(() => { window.originalSecond = document.getElementById('giftFeedStage').children[1]; });
  assert.equal((await frame(page, 500)).offset, -20);
  assert.equal((await frame(page, 1000)).offset, -40);
  assert.deepEqual(await frame(page, 2000), { ids: ['1', '2', '3', '4'], offset: 0, frames: 1 });
  assert.equal(await page.evaluate(() => window.originalSecond === document.getElementById('giftFeedStage').firstElementChild), true);
  assert.deepEqual(await frame(page, 9500), { ids: ['4', '0', '1', '2'], offset: -60, frames: 1 });
  assert.deepEqual(await frame(page, 10000), { ids: ['0', '1', '2', '3'], offset: 0, frames: 1 });
  assert.equal((await frame(page, 10500)).offset, -20);
});

test('speed 50 moves the following gift into the first position in 100 ms', async (t) => {
  const page = await openFeed(t, { scrollSpeed: 50 });
  await frame(page, 0);
  assert.equal((await frame(page, 50)).offset, -40);
  assert.deepEqual(await frame(page, 100), { ids: ['1', '2', '3', '4'], offset: 0, frames: 1 });
  assert.equal((await frame(page, 150)).offset, -40);
});

test('refresh preserves fractional motion and applies changed gifts at a row boundary', async (t) => {
  const page = await openFeed(t);
  await frame(page, 0);
  await frame(page, 1000);
  await page.evaluate(() => {
    window.originalFirst = document.getElementById('giftFeedStage').firstElementChild;
    window.feedItems[1].gift.num = 9;
    window.feedItems.push({ ...window.feedItems[0], eventId: 'new' });
  });
  await refreshFeed(page);
  assert.equal(await page.evaluate(() => window.originalFirst === document.getElementById('giftFeedStage').firstElementChild), true);
  assert.equal((await frame(page, 1500)).offset, -60);
  assert.deepEqual(await frame(page, 2000), { ids: ['1', '2', '3', '4'], offset: 0, frames: 1 });
  assert.equal(await page.locator('#giftFeedStage .gift-banner-count').first().textContent(), '×9');
  assert.deepEqual((await frame(page, 10000)).ids, ['new', '0', '1', '2']);
  await page.evaluate(() => { window.feedConfig.scrollSpeed = 50; });
  await refreshFeed(page);
  assert.equal((await frame(page, 10050)).offset, -40);
  assert.equal((await frame(page, 10100)).ids[0], '0');
});

test('feed stays static at capacity, starts above it and stops when refreshed below it', async (t) => {
  const page = await openFeed(t, { count: 3 });
  assert.deepEqual(await frame(page, 0), { ids: ['0', '1', '2'], offset: 0, frames: 0 });
  await page.evaluate(() => { window.feedItems.push({ ...window.feedItems[0], eventId: '3' }); });
  await refreshFeed(page);
  await frame(page, 0);
  assert.equal((await frame(page, 1000)).offset, -40);
  await page.evaluate(() => { window.feedItems = window.feedItems.slice(0, 1); });
  await refreshFeed(page);
  assert.deepEqual(await frame(page, 2000), { ids: ['0'], offset: 0, frames: 0 });
  await page.evaluate(() => { window.feedItems = []; });
  await refreshFeed(page);
  assert.deepEqual(await frame(page, 3000), { ids: [], offset: 0, frames: 0 });
});

test('merged cards control the row threshold and update every sender card without replacing unchanged renewal frames', async (t) => {
  const page = await openFeed(t);
  await frame(page, 0);
  await page.evaluate(() => {
    const day = new Date(Date.now() + 28800000).toISOString().slice(0, 10);
    window.feedItems.forEach((item, index) => {
      Object.assign(item.gift, { createdAt: `${day}T01:00:00Z`, unitPrice: 20, guardLevel: 3, giftId: index === 3 ? 'different' : 'same' });
    });
    window.feedProfiles = window.feedItems.map((item, index) => ({ eventId: item.eventId,
      senderId: index === 4 ? '200' : '100', userName: '重名', avatarUrl: null, guardLevel: 3, createdAt: item.gift.createdAt }));
    window.feedProfiles.push({ ...window.feedProfiles[0], eventId: 'unselected', userName: '新昵称', guardLevel: 2, createdAt: `${day}T02:00:00Z` });
  });
  await refreshFeed(page);
  const result = await frame(page, 2000);
  assert.equal(result.frames, 0);
  assert.equal(result.ids.length, 3);
  assert.deepEqual(await page.locator('#giftFeedStage .gift-banner-count').allTextContents(), ['×3', '×1', '×1']);
  assert.deepEqual(await page.locator('#giftFeedStage .gift-banner-name').allTextContents(), ['新昵称', '新昵称', '重名']);
  assert.deepEqual(await page.locator('#giftFeedStage .gift-banner-frame').evaluateAll((images) => images.map((image) => image.getAttribute('src').match(/bubble-(.*)-frame/)[1])), ['admiral', 'admiral', 'captain']);
  assert.equal(await page.locator('#giftFeedStage .gift-banner').first().evaluate((row) => row.style.getPropertyValue('--gift-start')), '#8F58EDF2');
  await page.evaluate(() => {
    window.unchangedCard = document.getElementById('giftFeedStage').firstElementChild;
    window.feedProfiles.push({ ...window.feedProfiles.at(-1), eventId: 'renewal', createdAt: window.feedProfiles.at(-1).createdAt.replace('02:00', '03:00') });
  });
  await refreshFeed(page);
  assert.equal(await page.evaluate(() => window.unchangedCard === document.getElementById('giftFeedStage').firstElementChild), true);
});

test('hidden feeds resume from the same position without catching up elapsed hidden time', async (t) => {
  const page = await openFeed(t);
  await frame(page, 0);
  await frame(page, 1000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.deepEqual(await frame(page, 9000), { ids: ['0', '1', '2', '3'], offset: -40, frames: 0 });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.deepEqual(await frame(page, 10000), { ids: ['0', '1', '2', '3'], offset: -40, frames: 1 });
  assert.equal((await frame(page, 10500)).offset, -60);
  assert.deepEqual(await frame(page, 11000), { ids: ['1', '2', '3', '4'], offset: 0, frames: 1 });
});

test('source changes clear the moving rows and pagehide cancels animation work', async (t) => {
  const page = await openFeed(t);
  await frame(page, 0);
  await frame(page, 1000);
  await page.evaluate(() => {
    window.feedItems = window.feedItems.map((item) => ({ ...item, eventId: `replacement-${item.eventId}` }));
    window.feedRevision = 'second';
    window.socketOptions.onMessage({ type: 'snapshot', state: { gifts: { viewRevision: 'second' } } });
  });
  assert.deepEqual(await frame(page, 1500), { ids: [], offset: 0, frames: 0 });
  await page.waitForFunction(() => window.feedScans === 2, {}, { polling: 20 });
  assert.deepEqual(await frame(page, 2000), { ids: ['replacement-0', 'replacement-1', 'replacement-2', 'replacement-3'], offset: 0, frames: 1 });
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  assert.deepEqual(await frame(page, 2500), { ids: [], offset: 0, frames: 0 });
});
