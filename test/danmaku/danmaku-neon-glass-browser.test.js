const test = require('node:test');
const assert = require('node:assert/strict');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

const openBrowserSession = useSharedBrowser();

test('neon glass preserves content, entry and shared perspective through updates and retraction', async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/danmaku.css">
    <body class="danmaku-overlay-body" data-style="neon-glass"><div class="danmaku-signal-stage">
      <div id="danmakuFeed" class="draw-danmaku-feed"></div></div></body>` });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage({ viewport: { width: 640, height: 720 } });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const { applyStyleOptions } = await import('/js/overlays/danmaku-style-application.js');
    const { createDanmakuFeed } = await import('/js/overlays/danmaku-feed.js');
    const { createComponentStyleEffects } = await import('/js/overlays/component-style-effects.js');
    const feed = createDanmakuFeed(document.getElementById('danmakuFeed'), { style: 'neon-glass',
      offscreenViewports: 0, autoScroll: false, expireItems: false });
    const effects = createComponentStyleEffects(document);
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    applyStyleOptions(document, 'neon-glass', {});
    feed.render([{ id: 'old', name: '观众', message: '原消息' }]);
    const original = document.querySelector('.neon-glass-item');
    effects.update('danmaku', { style: 'neon-glass', styleParameters: { 'neon-glass': {
      transform: { rotateY: -18, rotateZ: 2, perspective: 1600 }, textOutline: { width: 1, color: '#111111', opacity: 100 },
    } } });
    feed.append({ id: 'gift', kind: 'gift', name: '送礼者', giftName: '花', giftCount: 2, giftTotalPrice: 52 });
    await frame();
    const gift = document.querySelector('[data-neon-glass-kind="gift"]');
    const entry = gift.querySelector('.neon-glass-content').getAnimations()[0];
    entry.pause(); entry.currentTime = 240;
    const duringEntry = new DOMMatrix(getComputedStyle(gift).transform).is2D;
    applyStyleOptions(document, 'neon-glass', { 'neon-glass': { neonGlassIcons: 'hide', neonGlassHighlight: 0 } });
    const retained = original === document.querySelector('.neon-glass-item');
    const hiddenIcon = getComputedStyle(gift.querySelector('.neon-glass-icon')).display === 'none';
    effects.update('danmaku', { style: 'neon-glass' });
    const reset = getComputedStyle(original).transform === 'none';
    const message = '完整长留言'.repeat(8);
    feed.render([{ id: 'sc', kind: 'superchat', name: '留言者', message, price: 30 }]);
    await frame();
    const sc = document.querySelector('.neon-glass-item');
    const copy = sc.querySelector('.sc-copy');
    const content = sc.querySelector('.neon-glass-content');
    const complete = copy.textContent === message && content.scrollWidth <= content.clientWidth + 1;
    const contained = sc.getBoundingClientRect().height <= document.querySelector('.draw-danmaku-feed').clientHeight;
    feed.remove(['sc']);
    const retracted = !document.querySelector('.neon-glass-item');
    effects.dispose(); feed.destroy();
    return { duringEntry, retained, hiddenIcon, reset, complete, contained, retracted };
  });
  assert.equal(result.duringEntry, false, 'the authored entry keeps the public 3D transform');
  assert.ok(result.retained && result.hiddenIcon && result.reset, 'appearance edits reuse existing content and reset transforms');
  assert.ok(result.complete && result.contained, 'long SC remains complete within the region');
  assert.ok(result.retracted, 'only the requested SC is removed');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(async () => {
    const { createDanmakuFeed } = await import('/js/overlays/danmaku-feed.js');
    const feed = createDanmakuFeed(document.getElementById('danmakuFeed'), { style: 'neon-glass', offscreenViewports: 0 });
    feed.append({ id: 'reduced', name: '观众', message: '减少动态效果仍显示全文' });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const item = document.querySelector('.neon-glass-content');
    const visible = getComputedStyle(item).opacity === '1' && item.getAnimations().length === 0;
    feed.destroy();
    return visible;
  }), true);
});
