'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGiftFeedFixture } = require('./helpers/gift-feed-fixture');

const openFeed = createGiftFeedFixture();

test('ten thousand daily gifts keep only visible DOM rows through a rendering burst and release them on pagehide', async (t) => {
  const page = await openFeed(t, { count: 10000, scrollSpeed: 50 });
  const metrics = await page.evaluate(async () => {
    const stage = document.getElementById('giftFeedStage');
    let added = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) added += record.addedNodes.length;
    });
    observer.observe(stage, { childList: true });
    let maxRows = stage.children.length;
    for (let tick = 0; tick < 1000; tick += 1) {
      window.stepFeedFrame(tick * 16);
      maxRows = Math.max(maxRows, stage.children.length);
    }
    await Promise.resolve();
    observer.disconnect();
    window.dispatchEvent(new Event('pagehide'));
    return { maxRows, added, remainingRows: stage.children.length, remainingFrames: window.feedFrames.size };
  });
  assert.equal(metrics.maxRows, 4);
  assert.ok(metrics.added < 170, `rendering recreated ${metrics.added} rows instead of reusing visible rows`);
  assert.equal(metrics.remainingRows, 0);
  assert.equal(metrics.remainingFrames, 0);
  t.diagnostic(JSON.stringify(metrics));
});
