'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

let fixture;
let browser;
test.before(async () => {
  fixture = await startComponentPreviewServer({ parentHtml: '<!doctype html><link rel="stylesheet" href="/css/overlays/text-box.css"><main id="textBox"></main>' });
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); await fixture?.close(); });

async function mount(t) {
  const page = await browser.newPage({ viewport: { width: 640, height: 180 } });
  t.after(() => page.close());
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async () => {
    window.pendingFrames = new Map();
    let nextFrame = 0;
    window.requestAnimationFrame = callback => { pendingFrames.set(++nextFrame, callback); return nextFrame; };
    window.cancelAnimationFrame = id => pendingFrames.delete(id);
    window.advance = time => {
      const callbacks = [...pendingFrames.values()];
      pendingFrames.clear();
      callbacks.forEach(callback => callback(time));
    };
    const { createTextBoxDefaults } = await import('/js/shared/text-box-config.js');
    const { createTextBoxPlayback } = await import('/js/overlays/text-box-scroll.js');
    window.host = document.getElementById('textBox');
    window.config = createTextBoxDefaults();
    window.playback = createTextBoxPlayback(host);
    window.playback.update(config);
  });
  return page;
}

test('horizontal scrolling keeps one copy of long rich text and loops offscreen without per-frame layout reads', async t => {
  const page = await mount(t);
  const result = await page.evaluate(() => {
    const text = '欢迎来到直播间\n'.repeat(1250);
    config = { ...config, scrollMode: 'horizontal', nodes: [
      { type: 'text', text, bold: true, color: '#ffcc00', stroke: true },
      { type: 'gift', name: '舰长', src: '/img/admin/gifts/bilibili-guard-captain.webp' },
    ] };
    playback.update(config);
    const content = host.querySelector('.text-box-content');
    const maximum = host.scrollWidth - host.clientWidth;
    const start = host.scrollLeft;
    let reads = 0;
    for (const key of ['scrollWidth', 'scrollHeight', 'clientWidth', 'clientHeight']) {
      const { get } = Object.getOwnPropertyDescriptor(Element.prototype, key);
      Object.defineProperty(host, key, { configurable: true, get() { reads++; return get.call(this); } });
    }
    advance(0); advance(1000);
    const moved = host.scrollLeft - start;
    const frameReads = reads;
    playback.update(structuredClone(config));
    const unchanged = content === host.querySelector('.text-box-content') && host.scrollLeft === start + moved;
    // A whole cycle returns to exactly the same position, including the blank wrap.
    advance(maximum / 40 * 1000);
    const looped = host.scrollLeft;
    const style = getComputedStyle(content.firstChild);
    return { moved, start, looped, frameReads, unchanged, elements: host.querySelectorAll('*').length,
      text: content.textContent, expected: text.replace(/\n/g, ' '), images: host.querySelectorAll('img').length,
      fontWeight: style.fontWeight, color: style.color, height: content.clientHeight, frames: pendingFrames.size };
  });
  assert.equal(result.text, result.expected);
  assert.equal(result.images, 1);
  assert.ok(result.elements < 10, 'ten thousand characters do not become per-character nodes');
  assert.equal(result.fontWeight, '700');
  assert.equal(result.color, 'rgb(255, 204, 0)');
  assert.ok(result.height < 100, 'horizontal playback is a single line');
  assert.equal(result.moved, 40);
  assert.equal(result.looped, result.start);
  assert.equal(result.frameReads, 0);
  assert.equal(result.unchanged, true);
  assert.equal(result.frames, 1);
});

test('vertical scrolling preserves lines, remeasures dimensions, and returns intact to static display', async t => {
  const page = await mount(t);
  await page.evaluate(() => {
    config = { ...config, scrollMode: 'vertical', nodes: [{ type: 'text', text: '第一行\n第二行\n'.repeat(1250) }] };
    playback.update(config);
    advance(0); advance(1000);
  });
  assert.equal(await page.evaluate(() => host.scrollTop), 220);
  assert.equal(await page.locator('.text-box-scroll-track .text-box-content').textContent(), '第一行\n第二行\n'.repeat(1250));
  await page.setViewportSize({ width: 320, height: 180 });
  await page.waitForFunction(() => document.getElementById('textBox').style.height === '360px', null, { polling: 20, timeout: 3000 });
  const resized = await page.evaluate(() => {
    const content = host.querySelector('.text-box-content');
    return { scale: new DOMMatrix(getComputedStyle(host).transform).a, padding: parseFloat(getComputedStyle(content.parentElement).paddingTop),
      rect: host.getBoundingClientRect().toJSON(), elements: host.querySelectorAll('*').length };
  });
  assert.equal(resized.scale, 0.5);
  assert.equal(resized.padding, 360);
  assert.equal(resized.rect.height, 180);
  assert.ok(resized.elements < 5);
  const off = await page.evaluate(() => {
    playback.update({ ...config, scrollMode: 'none' });
    return { text: host.textContent, frames: pendingFrames.size, x: host.scrollLeft, y: host.scrollTop, spans: host.children.length };
  });
  assert.equal(off.text, '第一行\n第二行\n'.repeat(1250));
  assert.deepEqual([off.frames, off.x, off.y, off.spans], [0, 0, 0, 1]);
});

test('short content moves, hidden playback pauses, and empty or disposed playback schedules no frames', async t => {
  const page = await mount(t);
  const result = await page.evaluate(() => {
    config = { ...config, scrollMode: 'vertical', nodes: [{ type: 'text', text: '短文' }] };
    playback.update(config);
    advance(0); advance(1000);
    const moved = host.scrollTop;
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const pausedFrames = pendingFrames.size;
    advance(100000);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    advance(200000);
    const resumed = host.scrollTop;
    playback.update({ ...config, nodes: [] });
    const emptyFrames = pendingFrames.size;
    playback.update(config);
    playback.dispose();
    window.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new Event('visibilitychange'));
    playback.update(config);
    return { moved, resumed, pausedFrames, emptyFrames, disposedFrames: pendingFrames.size, elements: host.children.length };
  });
  assert.equal(result.moved, 220);
  assert.equal(result.resumed, result.moved, 'resuming does not jump by hidden elapsed time');
  assert.deepEqual([result.pausedFrames, result.emptyFrames, result.disposedFrames, result.elements], [0, 0, 0, 0]);
});
