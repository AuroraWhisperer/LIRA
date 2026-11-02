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

test('configured lyric sizes remain exact in a narrow output and the client preview', async t => {
  const page = await openRenderer(t);
  await page.setViewportSize({ width: 720, height: 800 });
  for (const surface of ['output', 'preview']) {
    if (surface === 'preview') {
      await page.addStyleTag({ url: `${fixture.origin}/css/admin/desktop-lyric-preview.css` });
      await page.evaluate(() => {
        document.body.className = 'desktop-lyric-workspace';
        const card = document.getElementById('desktopLyricSurface');
        card.classList.remove('lyric-window-card');
        card.style.width = '480px';
        document.getElementById('desktopLyricPreviewStage').classList.remove('lyric-window-stage');
      });
    }
    for (const fontSize of [24, 56, 72]) {
      const actual = await page.evaluate(async fontSize => {
        const renderer = window.testLyricRenderer;
        renderer.applySettings({ desktopLyricFontSize: String(fontSize), desktopLyricTranslationScale: '0.5',
          desktopLyricHideOnPause: 'false', desktopLyricShowRoma: 'true' });
        renderer.updateLyricTimeline({ status: 'ready', lines: [{ startMs: 0,
          text: '字号来自设置', translation: 'The selected size', roma: 'Selected size' }] });
        await document.fonts.ready;
        return ['text', 'translation', 'roma'].map(kind => parseFloat(getComputedStyle(
          document.querySelector(`.desktop-lyric-preview-row-${kind}`),
        ).fontSize));
      }, fontSize);
      for (const [index, expected] of [fontSize, fontSize * 0.5, fontSize * 0.5 * 0.86].entries()) {
        assert.ok(Math.abs(actual[index] - expected) < 0.01,
          `${surface}/${fontSize}px: text ${index} rendered at ${actual[index]}px instead of ${expected}px`);
      }
    }
  }
});

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
    await page.evaluate(mode => window.testLyricRenderer.applySettings({
      desktopLyricKaraokeMode: mode, desktopLyricSungColor: '#ff220080', desktopLyricTextColor: '#123456',
    }), desktopLyricKaraokeMode);
    assert.deepEqual(await colors(), { sung: 'rgba(255, 34, 0, 0.5)', unsung: 'rgb(18, 52, 86)', plain: 'rgb(18, 52, 86)' });
  }
  await page.addStyleTag({ url: `${fixture.origin}/css/lyrics/moonlit.css` });
  assert.equal((await colors()).sung, 'rgba(255, 34, 0, 0.5)', 'Moonlit respects an explicit sung color.');
  await page.evaluate(() => window.testLyricRenderer.applySettings({ desktopLyricSungColor: '', desktopLyricTextColor: '#654321' }));
  const inherited = await colors();
  assert.notEqual(inherited.sung, 'rgba(255, 34, 0, 0.5)', 'clearing the sung color restores the style color');
  assert.equal(inherited.unsung, 'rgb(101, 67, 33)');
  await render(page, text, [...text], { desktopLyricKaraokeMode: 'off',
    desktopLyricSungColor: '#ff2200', desktopLyricTextColor: '#123456' });
  assert.equal(await page.locator('.desktop-lyric-preview-word').count(), 0);
  assert.equal(await page.locator('.desktop-lyric-preview-row.is-active .desktop-lyric-preview-row-text')
    .evaluate(element => getComputedStyle(element).color), 'rgb(18, 52, 86)');
});

test('long interludes use the finished line without moving the next lyric in limited-line modes', async t => {
  const page = await openRenderer(t);
  await page.setViewportSize({ width: 960, height: 360 });
  await page.evaluate(() => {
    const text = '上一句已经唱完';
    window.testLyricRenderer.applySettings({ desktopLyricVisibleLines: '2', desktopLyricHideOnPause: 'false' });
    window.testLyricRenderer.updateLyricTimeline({ status: 'ready', lines: [
      { startMs: 0, endMs: 12000, text, words: [{ text, startMs: 0, endMs: 3000 }] },
      { startMs: 12000, endMs: 15000, text: '下一句准备开始' },
    ] });
  });
  const seek = currentMs => page.evaluate(currentMs => {
    window.testLyricRenderer.updateLyricState({ currentMs, durationMs: 20000, status: 'ready', playing: false,
      generation: 1, sequence: ++window.testLyricSequence, discontinuity: true });
  }, currentMs);
  const nextRow = page.locator('[data-lyric-index="1"]');
  const countdown = page.locator('.desktop-lyric-preview-countdown');
  await seek(8000);
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); });
  const before = await nextRow.boundingBox();
  await seek(9000);
  assert.equal(await countdown.isVisible(), true);
  assert.equal(await countdown.locator('..').getAttribute('data-lyric-index'), '0');
  assert.equal(await page.locator('.desktop-lyric-preview-row:visible').count(), 2);
  assert.ok(Math.abs((await nextRow.boundingBox()).y - before.y) < 1, 'the upcoming lyric must not jump when dots appear');
  assert.equal(await page.locator('[data-lyric-index="0"] .desktop-lyric-preview-row-text').isVisible(), false);

  await seek(4000);
  assert.equal(await countdown.isVisible(), false);
  assert.equal(await page.locator('[data-lyric-index="0"] .desktop-lyric-preview-row-text').isVisible(), true);
  await page.evaluate(() => window.testLyricRenderer.applySettings({ desktopLyricVisibleLines: '1' }));
  await seek(9500);
  assert.equal(await countdown.isVisible(), true);
  assert.equal(await page.locator('.desktop-lyric-preview-row:visible').count(), 1);
  await seek(12000);
  assert.equal(await countdown.isVisible(), false);
  assert.equal(await page.locator('.desktop-lyric-preview-row.is-interlude').count(), 0);

  await page.evaluate(() => window.testLyricRenderer.applySettings({ desktopLyricVisibleLines: '0' }));
  await seek(9000);
  assert.equal(await countdown.locator('..').getAttribute('id'), 'desktopLyricPreviewTimeline');
  assert.equal(await countdown.isVisible(), true);
  assert.equal(await countdown.count(), 1);
});

test('single and freshly laid out long lyrics follow the selected vertical anchor', async t => {
  const page = await openRenderer(t);
  await page.setViewportSize({ width: 960, height: 540 });
  const text = '这一刻让所有温柔的歌声陪着你穿过漫长夜晚';
  for (const desktopLyricVisibleLines of ['1', '0']) {
    await render(page, text, [...text], { desktopLyricVisibleLines, desktopLyricTextAlign: 'center',
      desktopLyricFontSize: '48', desktopLyricAlignPosition: '0.5' });
    await page.waitForFunction(() => {
      const viewport = document.getElementById('desktopLyricPreviewViewport').getBoundingClientRect();
      const row = document.querySelector('.desktop-lyric-preview-row.is-active').getBoundingClientRect();
      return Math.abs(row.top + row.height / 2 - viewport.top - viewport.height / 2) < 1;
    }, null, { timeout: 3000 });
  }
});

test('preview backgrounds contrast with the selected text while the output stays transparent', async t => {
  const page = await openRenderer(t);
  for (const color of ['#000000', '#ffffff']) {
    await page.evaluate(color => window.testLyricRenderer.applySettings({ desktopLyricTextColor: color }), color);
    assert.equal(await page.locator('#desktopLyricPreviewStage').evaluate(element => getComputedStyle(element).backgroundColor),
      'rgba(0, 0, 0, 0)');
  }
  await page.evaluate(() => {
    document.getElementById('desktopLyricSurface').classList.remove('lyric-window-card');
    document.getElementById('desktopLyricPreviewStage').classList.remove('lyric-window-stage');
  });
  const luminance = rgb => {
    const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (const [color, foreground] of [['#000000', 0], ['#ffffff', 1]]) {
    for (const solid of [false, true]) {
      const background = await page.evaluate(({ color, solid }) => {
        window.testLyricRenderer.applySettings({ desktopLyricTextColor: color });
        const stage = document.getElementById('desktopLyricPreviewStage');
        stage.classList.toggle('is-solid', solid);
        return getComputedStyle(stage).backgroundColor;
      }, { color, solid });
      const light = luminance(background);
      assert.ok((Math.max(light, foreground) + 0.05) / (Math.min(light, foreground) + 0.05) > 7,
        `${color} lyrics must remain readable on the ${solid ? 'solid' : 'checker'} preview`);
    }
  }
});
