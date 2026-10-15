'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

let browser;
let fixture;
test.before(async () => {
  const parentHtml = fs.readFileSync(path.join(__dirname, '../../public/pages/overlays/lyric-window.html'), 'utf8')
    .replace(/<script type="module" src="\/js\/overlays\/lyric-window\.js[^"]*"><\/script>/, '');
  fixture = await startComponentPreviewServer({ parentHtml });
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); await fixture?.close(); });

async function openRenderer(t, { slowFrames = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 },
    reducedMotion: slowFrames ? 'no-preference' : 'reduce' });
  if (slowFrames) await context.addInitScript(() => {
    window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 60);
    window.cancelAnimationFrame = clearTimeout;
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await context.close(); assert.deepEqual(errors, []); });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async () => {
    const { desktopLyricRenderer } = await import('/js/lyrics/desktop-lyric-renderer.js');
    window.testLyricRenderer = desktopLyricRenderer;
    window.testLyricSequence = 0;
    desktopLyricRenderer.init();
  });
  return page;
}

test('continuous fill keeps advancing between slow JS frames and still pauses precisely', async t => {
  const page = await openRenderer(t, { slowFrames: true });
  await page.evaluate(() => {
    const renderer = window.testLyricRenderer;
    const text = '这一句歌词应当一点一点填满';
    const words = [{ text, startMs: 0, endMs: 8000 }];
    renderer.applySettings({ desktopLyricKaraokeMode: 'continuous', desktopLyricHideOnPause: 'false' });
    renderer.updateLyricTimeline({ status: 'ready', lines: [{ startMs: 0, text, words }] });
    renderer.updateLyricState({ status: 'ready', currentMs: 0, durationMs: 8000, playing: true,
      generation: 1, sequence: ++window.testLyricSequence, lineText: text, words, discontinuity: true });
  });
  await page.waitForFunction(() => document.getElementById('desktopLyricPreviewStage').classList.contains('is-low-power'));
  const samples = await page.evaluate(async () => {
    const highlight = document.querySelector('.desktop-lyric-preview-word-highlight');
    const values = [];
    for (let index = 0; index < 8; index += 1) {
      await new Promise(resolve => setTimeout(resolve, 150));
      values.push(getComputedStyle(highlight).clipPath);
    }
    return values;
  });
  assert.ok(new Set(samples).size >= 6, 'a long sung word must keep filling instead of waiting for its end');
  const paused = await page.evaluate(async () => {
    window.testLyricRenderer.updateLyricState({ playing: false, currentMs: 1000,
      generation: 1, sequence: ++window.testLyricSequence, discontinuity: true });
    const highlight = document.querySelector('.desktop-lyric-preview-word-highlight');
    const before = getComputedStyle(highlight).clipPath;
    await new Promise(resolve => setTimeout(resolve, 200));
    return { before, after: getComputedStyle(highlight).clipPath };
  });
  assert.equal(paused.before, 'inset(0px 87.5% 0px 0px)');
  assert.equal(paused.after, paused.before);
});

async function render(page, text, tokens, settings) {
  await page.evaluate(async ({ text, tokens, settings }) => {
    const renderer = window.testLyricRenderer;
    renderer.applySettings({ desktopLyricFontSize: '40', desktopLyricStrokeEnabled: 'false',
      desktopLyricShadowEnabled: 'false', ...settings });
    const words = tokens.map((text, index) => ({ text, startMs: 5000 + index * 500, endMs: 5500 + index * 500 }));
    renderer.updateLyricTimeline({ status: 'ready', lines: [
      { startMs: 0, text }, { startMs: 5000, text, words }, { startMs: 20000, text },
    ] });
    renderer.updateLyricState({ status: 'ready', currentMs: 5000, durationMs: 30000, playing: false,
      generation: 1, sequence: ++window.testLyricSequence, lineText: text, words, discontinuity: true });
    document.getElementById('desktopLyricPreviewTimeline').getBoundingClientRect();
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, { text, tokens, settings });
}

async function measure(page) {
  return page.locator('.desktop-lyric-preview-row').evaluateAll(rows => rows.map(row => {
    const text = row.querySelector('.desktop-lyric-preview-row-text');
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    const lines = new Map();
    const range = document.createRange();
    for (let node; (node = walker.nextNode());) {
      if (node.parentElement.closest('[aria-hidden="true"]')) continue;
      for (let index = 0; index < node.textContent.length; index++) {
        if (/\s/.test(node.textContent[index])) continue;
        range.setStart(node, index); range.setEnd(node, index + 1);
        const rect = range.getBoundingClientRect();
        const top = Math.round(rect.top);
        const line = lines.get(top) || { left: Infinity, right: -Infinity };
        line.left = Math.min(line.left, rect.left); line.right = Math.max(line.right, rect.right);
        lines.set(top, line);
      }
    }
    const bounds = row.getBoundingClientRect();
    return { center: bounds.left + bounds.width / 2, lines: [...lines.values()] };
  }));
}

test('active karaoke lines keep the selected left, center, right and justified alignment', async t => {
  const page = await openRenderer(t);
  const text = '天地弹指间俯仰梦中身';
  for (const desktopLyricTextAlign of ['left', 'center', 'right', 'justify']) {
    for (const desktopLyricKaraokeMode of ['continuous', 'discrete', 'off']) {
      await render(page, text, [...text], { desktopLyricTextAlign, desktopLyricKaraokeMode });
      const [plain, active] = await measure(page);
      for (const edge of ['left', 'right']) {
        assert.ok(Math.abs(plain.lines[0][edge] - active.lines[0][edge]) < 1,
          `${desktopLyricTextAlign}/${desktopLyricKaraokeMode}: ${edge} must stay aligned when highlighting starts.`);
      }
    }
  }
});

test('centered lyrics preserve word spaces, balance wrapping and keep scaling on the same axis', async t => {
  const page = await openRenderer(t);
  const short = 'Dream with me under the moon';
  await render(page, short, short.match(/\S+\s*/g), { desktopLyricTextAlign: 'center' });
  const [plain, active] = await measure(page);
  for (const edge of ['left', 'right']) {
    assert.ok(Math.abs(plain.lines[0][edge] - active.lines[0][edge]) < 1,
      'Entering karaoke must preserve spaces and the centered line width.');
  }

  const long = '把这段温柔的歌声送给屏幕前一直陪伴我的你愿今夜的星光照亮每一个梦';
  await page.setViewportSize({ width: 700, height: 800 });
  for (const tokens of [[...long], [long]]) {
    await render(page, long, tokens, { desktopLyricTextAlign: 'center', desktopLyricScaleEffect: 'true' });
    const rows = await measure(page);
    for (const row of rows) {
      assert.ok(Math.abs(row.center - 350) < 1, 'Scaling must retain the viewport center for every row.');
      assert.equal(row.lines.length, 2);
      const widths = row.lines.map(line => line.right - line.left);
      assert.ok(Math.min(...widths) / Math.max(...widths) > 0.8, 'Centered wrapping must avoid a short dangling last line.');
    }
  }
});

test('karaoke colors update both modes independently and restore each style when inherited', async t => {
  const page = await openRenderer(t);
  const text = '唱词';
  const colors = () => page.evaluate(() => {
    const color = selector => getComputedStyle(document.querySelector(selector)).color;
    return {
      sung: color('.desktop-lyric-preview-word-highlight'),
      unsung: color('.desktop-lyric-preview-word-base'),
      plain: color('.desktop-lyric-preview-row:not(.is-active) .desktop-lyric-preview-row-text'),
    };
  });
  for (const desktopLyricKaraokeMode of ['continuous', 'discrete']) {
    await render(page, text, [...text], { desktopLyricKaraokeMode });
    assert.deepEqual(await colors(), { sung: 'rgb(255, 207, 74)', unsung: 'rgb(0, 0, 0)', plain: 'rgb(0, 0, 0)' });
    await page.evaluate(mode => window.testLyricRenderer.applySettings({
      desktopLyricKaraokeMode: mode, desktopLyricSungColor: '#ff220080', desktopLyricTextColor: '#123456',
    }), desktopLyricKaraokeMode);
    assert.deepEqual(await colors(), { sung: 'rgba(255, 34, 0, 0.5)', unsung: 'rgb(18, 52, 86)', plain: 'rgb(18, 52, 86)' });
  }
  await page.addStyleTag({ url: `${fixture.origin}/css/lyrics/moonlit.css` });
  assert.equal((await colors()).sung, 'rgba(255, 34, 0, 0.5)', 'Moonlit respects an explicit sung color.');
  await page.evaluate(() => window.testLyricRenderer.applySettings({ desktopLyricSungColor: '', desktopLyricTextColor: '#654321' }));
  assert.deepEqual(await colors(), { sung: 'rgb(147, 104, 47)', unsung: 'rgb(101, 67, 33)', plain: 'rgb(101, 67, 33)' });
  await render(page, text, [...text], { desktopLyricKaraokeMode: 'off',
    desktopLyricSungColor: '#ff2200', desktopLyricTextColor: '#123456' });
  assert.equal(await page.locator('.desktop-lyric-preview-word').count(), 0);
  assert.equal(await page.locator('.desktop-lyric-preview-row.is-active .desktop-lyric-preview-row-text')
    .evaluate(element => getComputedStyle(element).color), 'rgb(18, 52, 86)');
});
