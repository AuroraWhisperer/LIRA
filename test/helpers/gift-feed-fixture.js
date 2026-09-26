'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createUiFixture } = require('./ui-edit-state-fixture');

function createGiftFeedFixture() {
  const fixture = createUiFixture();
  // Speed 31 advances one row in two seconds on the 5–0.1 second scale.
  return async function openFeed(t, { count = 5, scrollSpeed = 31, missingAbortMethods = [] } = {}) {
    const page = await fixture(t, 'gift-feed');
    await page.setContent(
      '<main id="giftFeedViewport"><div id="giftFeedStage" class="gift-banner-stage"></div></main><p id="giftFeedStatus"></p>',
    );
    for (const file of ['shared/gift-banner.css', 'overlays/gift-feed.css']) {
      await page.addStyleTag({ content: fs.readFileSync(path.resolve('public/css', file), 'utf8') });
    }
    await page.evaluate(
      async ({ count, scrollSpeed, missingAbortMethods }) => {
        for (const method of missingAbortMethods) delete AbortSignal[method];
        window.feedConfig = { palette: 'bilibili-four', thresholds: [3000, 10000, 100000], visibleRows: 3, scrollSpeed };
        window.feedItems = Array.from({ length: count }, (_, index) => ({
          eventId: String(index),
          gift: { giftId: 'sample', giftName: '礼物', userName: `观众${index}`, unitPrice: 2, num: 1 },
        }));
        window.feedRevision = 'first';
        window.feedProfiles = [];
        window.feedScans = 0;
        window.feedRequests = [];
        window.feedFrames = new Map();
        let frameId = 0;
        window.requestAnimationFrame = (callback) => {
          window.feedFrames.set(++frameId, callback);
          return frameId;
        };
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
          else if (url.startsWith('/api/gifts/card-profiles?'))
            data = {
              viewRevision: window.feedRevision,
              day: new Date(Date.now() + 28800000).toISOString().slice(0, 10),
              items: window.feedProfiles,
              partial: false,
            };
          else if (url === '/api/overtime/gifts/catalog') data = { gifts: [] };
          else if (url.startsWith('/api/gifts/history?')) {
            window.feedScans += 1;
            data = { items: window.feedItems, viewRevision: window.feedRevision, nextCursor: null, partial: false };
          } else throw new Error(`Unexpected fetch: ${url}`);
          return { ok: true, json: async () => ({ ok: true, data: structuredClone(data) }) };
        };
        await import('/js/overlays/gift-feed.js');
      },
      { count, scrollSpeed, missingAbortMethods },
    );
    await page.waitForFunction(
      () => window.feedScans === 1 || document.getElementById('giftFeedStatus').textContent,
      {},
      { polling: 20 },
    );
    assert.equal(await page.locator('#giftFeedStatus').textContent(), '');
    return page;
  };
}

module.exports = { createGiftFeedFixture };
