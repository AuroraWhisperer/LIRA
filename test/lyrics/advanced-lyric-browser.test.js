'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

let browser;
let fixture;
test.before(async () => {
  fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html><meta charset="utf-8">
    <link rel="stylesheet" href="/css/lyrics/advanced-lyric.css">
    <style>body{margin:0}#stage{width:680px;height:300px}</style><div id="stage"></div>` });
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); await fixture?.close(); });

async function openRenderer(t) {
  const page = await browser.newPage({ viewport: { width: 700, height: 320 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async () => {
    const { createAdvancedLyricRenderer } = await import('/js/lyrics/advanced-lyric-renderer.js');
    window.renderer = createAdvancedLyricRenderer(document.getElementById('stage'));
    window.lyricSettings = { advancedLyricFontFamily: 'Microsoft YaHei', advancedLyricShowNextLine: 'false' };
    window.renderer.applySettings(window.lyricSettings);
  });
  return page;
}

test('every advanced layout reveals only reached current-line glyphs, including decorative copies', async t => {
  const page = await openRenderer(t);
  const results = await page.evaluate(async () => {
    const { ADVANCED_LYRIC_CATALOG } = await import('/js/shared/advanced-lyric-catalog.js');
    const root = document.getElementById('stage');
    const line = { text: '甲乙丙丁', startMs: 1000, endMs: 6000,
      words: [...'甲乙丙丁'].map((text, index) => ({ text, startMs: 1000 + index * 1000, endMs: 1800 + index * 1000 })) };
    const results = [];
    for (const [index, { id }] of ADVANCED_LYRIC_CATALOG.layouts.entries()) {
      window.renderer.applySettings({ ...window.lyricSettings, advancedLyricLayout: id,
        advancedLyricMaterial: ADVANCED_LYRIC_CATALOG.materials[index % ADVANCED_LYRIC_CATALOG.materials.length].id,
        advancedLyricEnter: ADVANCED_LYRIC_CATALOG.enters[index % ADVANCED_LYRIC_CATALOG.enters.length].id,
        advancedLyricShowNextLine: 'true', advancedLyricWordMotion: 'none', advancedLyricEchoEnabled: 'true' });
      window.renderer.renderFrame({ line, nextLine: { text: '下一句', startMs: 6000, endMs: 10000 },
        index: 0, currentMs: 2500, playing: false });
      const visible = [...root.querySelectorAll('.advanced-lyric-glyph')].filter(glyph => {
        for (let node = glyph; node && node !== root; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.visibility === 'hidden' || Number(style.opacity) === 0 || style.clipPath === 'inset(0px 100% 0px 0px)') return false;
        }
        return true;
      });
      results.push({ layout: id, label: root.getAttribute('aria-label'),
        future: root.querySelectorAll('[data-source="next"]').length,
        visible: [...new Set(visible.map(node => node.dataset.text))].join('') });
    }
    return results;
  });
  for (const result of results) {
    assert.equal(result.future, 0, `${result.layout} must not render the next line even with an old setting`);
    assert.equal(result.label, '甲乙丙丁');
    assert.equal(result.visible, '甲乙', `${result.layout} must hide every copy of unsung glyphs`);
  }
});

test('unsung visibility toggles immediately and restores after pause, backward seek and hidden playback', async t => {
  const page = await openRenderer(t);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const result = await page.evaluate(async () => {
    const root = document.getElementById('stage');
    const line = { text: '一二三四', startMs: 1000, endMs: 5000 };
    const frame = { line, index: 0, currentMs: 2500, playing: false };
    const shown = () => [...root.querySelectorAll('.advanced-lyric-glyph')].filter(glyph => {
      for (let node = glyph; node && node !== root; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.visibility === 'hidden' || Number(style.opacity) === 0 || style.clipPath === 'inset(0px 100% 0px 0px)') return false;
      }
      return true;
    }).map(node => node.dataset.text).join('');
    window.renderer.renderFrame(frame);
    const initial = shown();
    await new Promise(resolve => setTimeout(resolve, 120));
    const paused = shown();
    window.renderer.applySettings({ ...window.lyricSettings, advancedLyricHideUnsung: 'false' });
    const full = shown();
    window.renderer.applySettings(window.lyricSettings);
    window.renderer.renderFrame({ ...frame, currentMs: 1499, discontinuity: true });
    const seeked = shown();
    window.renderer.setVisible(false);
    window.renderer.renderFrame({ ...frame, currentMs: 3500 });
    window.renderer.setVisible(true);
    const resumed = shown();
    window.renderer.renderFrame({ ...frame, currentMs: 900 });
    const before = shown();
    window.renderer.renderFrame({ ...frame, currentMs: 5000 });
    return { initial, paused, full, seeked, resumed, before, after: shown() };
  });
  assert.equal(result.initial, '一二');
  assert.equal(result.paused, result.initial);
  assert.equal(result.full, '一二三四');
  assert.equal(result.seeked, '一');
  assert.equal(result.resumed, '一二三');
  assert.equal(result.before, '');
  assert.equal(result.after, '');
});

test('advanced layouts retain complete long lyrics inside the output', async t => {
  const page = await openRenderer(t);
  const text = '把长长的一句歌词唱完 Remember every word with 👨‍👩‍👧‍👦 and Cafe\u0301 in the moonlight';
  for (const layout of ['center', 'vertical', 'tiles', 'orbit']) {
    const result = await page.evaluate(async ({ text, layout }) => {
      window.renderer.applySettings({ ...window.lyricSettings, advancedLyricLayout: layout });
      window.frame = { line: { text, startMs: 0, endMs: 10000 }, index: 1, currentMs: 4500, playing: false };
      window.renderer.renderFrame(window.frame);
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const root = document.getElementById('stage');
      const bounds = root.getBoundingClientRect();
      const glyphs = [...root.querySelectorAll('[data-source="current"] .advanced-lyric-ink')];
      return { text: glyphs.map(node => node.textContent).join(''), clipped: glyphs.filter(node => {
        if (!node.textContent.trim()) return false;
        const rect = node.getBoundingClientRect();
        return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1;
      }).map(node => node.textContent) };
    }, { text, layout });
    assert.equal(result.text, text, `${layout} must keep every character`);
    assert.deepEqual(result.clipped, [], `${layout} must fit the full line in its output`);
  }
});

test('timed groups keep future backplates hidden and retain the final sung glyph until the line ends', async t => {
  const page = await openRenderer(t);
  const result = await page.evaluate(() => {
    const root = document.getElementById('stage');
    window.renderer.applySettings({ ...window.lyricSettings, advancedLyricLayout: 'tiles', advancedLyricExit: 'shrink' });
    const line = { text: '唱完', startMs: 1000, endMs: 5000, words: [
      { text: '唱', startMs: 1000, endMs: 2000 }, { text: '完', startMs: 4000, endMs: 5000 },
    ] };
    window.renderer.renderFrame({ line, index: 0, currentMs: 2500, playing: false });
    const futurePlate = getComputedStyle(root.querySelectorAll('.advanced-lyric-enter')[1]).opacity;
    window.renderer.renderFrame({ line, index: 0, currentMs: 4999, playing: false });
    const tail = root.querySelectorAll('.advanced-lyric-glyph')[1];
    let tailOpacity = 1;
    for (let node = tail; node && node !== root; node = node.parentElement) tailOpacity *= Number(getComputedStyle(node).opacity);
    window.renderer.renderFrame({ line: { text: '下一句', startMs: 5000, endMs: 8000 }, index: 1, currentMs: 5500, playing: false });
    return { futurePlate, tailOpacity, current: root.getAttribute('aria-label'), previous: root.textContent.includes('唱完') };
  });
  assert.equal(result.futurePlate, '0');
  assert.equal(result.tailOpacity, 1);
  assert.equal(result.current, '下一句');
  assert.equal(result.previous, false);
});

test('advanced fill interpolates, pauses and seeks from the shared clock and releases hidden animations', async t => {
  const page = await openRenderer(t);
  const result = await page.evaluate(async () => {
    window.frame = { line: { text: '唱', startMs: 0, endMs: 10000, words: [{ text: '唱', startMs: 0, endMs: 10000 }] },
      index: 0, currentMs: 1000, playing: true, playbackRate: 2 };
    window.renderer.renderFrame(window.frame);
    const root = document.getElementById('stage');
    const highlight = root.querySelector('.advanced-lyric-highlight');
    const clip = () => getComputedStyle(highlight).clipPath;
    const first = clip();
    await new Promise(resolve => setTimeout(resolve, 160));
    const advancing = clip();
    window.frame = { ...window.frame, currentMs: 2500, playing: false, discontinuity: true };
    window.renderer.renderFrame(window.frame);
    const paused = clip();
    await new Promise(resolve => setTimeout(resolve, 160));
    const stillPaused = clip();
    const runningWhilePaused = root.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length;
    window.frame = { ...window.frame, currentMs: 1000 };
    window.renderer.renderFrame(window.frame);
    const seeked = clip();
    window.renderer.setVisible(false);
    const hiddenAnimations = root.getAnimations({ subtree: true }).length;
    window.frame = { ...window.frame, currentMs: 4000 };
    window.renderer.renderFrame(window.frame);
    window.renderer.setVisible(true);
    const resumed = clip();
    window.renderer.dispose();
    return { first, advancing, paused, stillPaused, runningWhilePaused, seeked, hiddenAnimations, resumed,
      disposedAnimations: document.getAnimations().length };
  });
  assert.notEqual(result.advancing, result.first);
  assert.equal(result.paused, 'inset(0px 75% 0px 0px)');
  assert.equal(result.stillPaused, result.paused);
  assert.equal(result.runningWhilePaused, 0);
  assert.equal(result.seeked, 'inset(0px 90% 0px 0px)');
  assert.equal(result.hiddenAnimations, 0);
  assert.equal(result.resumed, 'inset(0px 60% 0px 0px)');
  assert.equal(result.disposedAnimations, 0);
});

test('steady frames and color changes reuse glyphs without layout measurement', async t => {
  const page = await openRenderer(t);
  const result = await page.evaluate(async () => {
    const root = document.getElementById('stage');
    window.frame = { line: { text: '这一句持续演唱', startMs: 0, endMs: 10000 }, index: 0, currentMs: 1000, playing: false };
    window.renderer.renderFrame(window.frame);
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const glyph = root.querySelector('.advanced-lyric-glyph');
    let reads = 0;
    const restores = [];
    for (const [proto, keys] of [[Element.prototype, ['clientWidth', 'clientHeight', 'scrollWidth']],
      [HTMLElement.prototype, ['offsetWidth', 'offsetHeight']]]) {
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, key);
        Object.defineProperty(proto, key, { ...descriptor, get() { reads++; return descriptor.get.call(this); } });
        restores.push(() => Object.defineProperty(proto, key, descriptor));
      }
    }
    try {
      for (let index = 0; index < 80; index++) window.renderer.renderFrame({ ...window.frame, currentMs: 1000 + index * 20 });
      window.renderer.applySettings({ ...window.lyricSettings, advancedLyricTextColor: '#ddccff', advancedLyricMaterial: 'glass' });
      return { reads, sameGlyph: glyph === root.querySelector('.advanced-lyric-glyph'), material: root.dataset.material };
    } finally { restores.forEach(restore => restore()); }
  });
  assert.equal(result.reads, 0);
  assert.equal(result.sameGlyph, true);
  assert.equal(result.material, 'glass');
});

test('switching marker material refits long lyrics without clipping the last characters', async t => {
  const page = await openRenderer(t);
  const clipped = await page.evaluate(async () => {
    const settings = { ...window.lyricSettings, advancedLyricLayout: 'corners', advancedLyricWidth: '100',
      advancedLyricShowNextLine: 'true', advancedLyricWordMotion: 'none' };
    window.renderer.applySettings(settings);
    window.renderer.renderFrame({ line: { text: 'Remember every word in the moonlight', startMs: 0, endMs: 8000 },
      nextLine: { text: '把此刻唱成一束光', startMs: 8000, endMs: 14000 }, index: 0, currentMs: 4000, playing: false });
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.renderer.applySettings({ ...settings, advancedLyricMaterial: 'marker' });
    const root = document.getElementById('stage');
    const bounds = root.getBoundingClientRect();
    return [...root.querySelectorAll('[data-source="current"] .advanced-lyric-ink')].filter(node => {
      const rect = node.getBoundingClientRect();
      return node.textContent.trim() && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1
        || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1);
    }).map(node => node.textContent);
  });
  assert.deepEqual(clipped, []);
});
