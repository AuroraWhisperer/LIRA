'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

// Real layout is required: fractional scroll offsets are rounded by the browser.
test('song scrolling preserves fractional movement at low speeds and high refresh rates', async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: '<!doctype html><html><body></body></html>' });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage();
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const measurements = await page.evaluate(async () => {
    const { SongVirtualScroller } = await import('/js/overlays/song-virtual-scroller.js');
    const { scrollSpeedToDuration } = await import('/js/overlays/songs.js');
    const viewport = document.createElement('div');
    viewport.style.cssText = 'width:400px;overflow:hidden;overflow-anchor:none';
    const content = document.createElement('div');
    content.style.overflowAnchor = 'none';
    viewport.append(content);
    document.body.append(viewport);
    const results = [];
    for (const height of [450, 722]) {
      viewport.style.height = `${height}px`;
      for (const fps of [60, 120, 144, 240]) {
        for (const speed of [1, 10, 15, 100]) {
          const scroller = new SongVirtualScroller({ viewport, content,
            createNode(record) {
              const node = document.createElement('div');
              node.textContent = record.key;
              node.style.height = '53.5px';
              return node;
            }, requestFrame: () => 1, cancelFrame() {} });
          scroller.setRecords(Array.from({ length: 100 }, (_, index) => ({ key: String(index) })), { key: '50', offset: 5 });
          const seconds = Number(scrollSpeedToDuration(speed));
          scroller.setSecondsPerViewport(seconds);
          const position = () => {
            const anchor = scroller.captureAnchor();
            return anchor.index * 53.5 + anchor.offset;
          };
          const start = position();
          scroller.start();
          for (let frame = 0; frame <= fps; frame++) scroller.tick(frame * 1000 / fps);
          results.push({ height, fps, speed, actual: position() - start, expected: height / seconds });
          scroller.pause();
          const paused = position();
          scroller.tick(60000);
          results.push({ height, fps, speed, phase: 'paused', actual: position() - paused, expected: 0 });
          scroller.start();
          for (let frame = 0; frame <= fps; frame++) scroller.tick(60000 + frame * 1000 / fps);
          results.push({ height, fps, speed, phase: 'resumed', actual: position() - start, expected: 2 * height / seconds });
          scroller.destroy();
        }
      }
    }
    viewport.remove();
    return results;
  });
  for (const result of measurements) {
    assert.ok(Math.abs(result.actual - result.expected) <= 1, JSON.stringify(result));
  }
});
