'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

test('each style scales its text with font settings and explicit canvas scaling', async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/danmaku.css">
    <style>.danmaku-signal-stage { transition: none !important; }</style>
    <div class="danmaku-canvas-space"><div class="danmaku-canvas"><div class="danmaku-region">
      <div class="danmaku-signal-stage"><div id="feed" class="draw-danmaku-feed"></div></div>
    </div></div></div>` });
  t.after(() => fixture.close());
  const session = openBrowserSession();
  t.after(() => session.close());
  const page = await session.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const measurements = await page.evaluate(async () => {
    const { DANMAKU_STYLE_OPTIONS, applyStyleOptions } = await import('/js/shared/danmaku-style-options.js');
    const { createLayout } = await import('/js/shared/danmaku-layout.js');
    const { applyCanvas } = await import('/js/overlays/danmaku-canvas.js');
    const { createDanmakuMessageRenderer, DEFAULT_DANMAKU_CLASSES } = await import('/js/overlays/danmaku-message-renderer.js');
    const root = document.getElementById('feed');
    const results = [];
    for (const [style, limits] of Object.entries(DANMAKU_STYLE_OPTIONS)) {
      document.body.dataset.style = style;
      const render = createDanmakuMessageRenderer({ document, style, classNames: DEFAULT_DANMAKU_CLASSES });
      const messages = [
        { name: '观众', message: '正文大小' },
        { kind: 'gift', name: '观众', giftName: '礼物', giftCount: 2, giftTotalPrice: 30 },
      ];
      const hasSuperchat = limits.scrollDirection || style === 'mist';
      if (hasSuperchat) messages.push({ kind: 'superchat', name: '观众', message: '留言大小', price: 30 });
      for (const fontSize of [limits.minFontSize, limits.maxFontSize]) {
        applyStyleOptions(document, style, { [style]: { fontSize } });
        root.replaceChildren(...messages.map(render));
        const cards = Array.from(root.children);
        const paragraph = (card, text) => Array.from(card.querySelectorAll('p')).find(node => node.textContent === text);
        const giftSelector = style === 'ripploid' ? '.ripploid-gift-name'
          : style === 'flower-letter' ? '.flower-gift-name'
            : limits.speed ? 'p' : '.draw-danmaku-gift-name';
        const content = [
          ['chat', paragraph(cards[0], '正文大小')],
          ['gift', cards[1].querySelector(giftSelector)],
          ...(hasSuperchat ? [['superchat', paragraph(cards[2], '留言大小')]] : []),
        ];
        for (const scale of [1, 0.75]) {
          const layout = createLayout();
          const region = layout.regions[style];
          region.width *= scale;
          region.height *= scale;
          layout.contentScale *= scale;
          applyCanvas(document, layout, style, 1920, 1080);
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          for (const [kind, node] of content) {
            if (!node) throw new Error(`${style}: missing ${kind} content`);
            // A rendered em includes inherited card zoom and canvas transforms.
            const probe = document.createElement('span');
            probe.style.cssText = 'position:absolute;display:block;width:1em;height:1em;padding:0;border:0';
            node.append(probe);
            results.push({ style, fontSize, scale, kind, width: probe.getBoundingClientRect().width });
            probe.remove();
          }
        }
      }
    }
    return results;
  });
  const baselines = new Map();
  for (const result of measurements) {
    const { style, fontSize, scale, kind, width } = result;
    const key = `${style}:${kind}`;
    assert.ok(Number.isFinite(width) && width > 0, `${key} renders visible text`);
    const nativeLettering = style === 'flower-letter'
      || kind === 'superchat' && ['ripploid', 'notebook'].includes(style)
      || kind === 'gift' && ['ripploid', 'spooky'].includes(style);
    if (!nativeLettering) {
      assert.ok(Math.abs(width - fontSize * scale) <= 0.1, JSON.stringify(result));
    }
    if (!baselines.has(key)) baselines.set(key, result);
    const baseline = baselines.get(key);
    // RIPPLOID's gift ticket owns fixed lettering; chat and SC still use the text setting.
    const fontScale = style === 'ripploid' && kind === 'gift' ? 1 : fontSize / baseline.fontSize;
    const expected = baseline.width * fontScale * scale;
    assert.ok(Math.abs(width - expected) <= 0.1, JSON.stringify({ ...result, expected }));
  }
});
