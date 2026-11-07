'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

test('animated gradient keeps large text, paid details and emotes inside a narrow region', async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/danmaku.css">
    <body data-style="animated-gradient"><div class="danmaku-signal-stage" style="width:320px;height:900px">
      <div id="feed" class="draw-danmaku-feed"></div>
    </div></body>` });
  const session = openBrowserSession();
  t.after(async () => { await session.close(); await fixture.close(); });
  const page = await session.newPage({ viewport: { width: 640, height: 960 }, reducedMotion: 'reduce' });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const results = await page.evaluate(async () => {
    const { createDanmakuMessageRenderer, DEFAULT_DANMAKU_CLASSES } = await import('/js/overlays/danmaku-message-renderer.js');
    const { applyStyleOptions } = await import('/js/overlays/danmaku-style-application.js');
    applyStyleOptions(document, 'animated-gradient', { 'animated-gradient': { fontSize: 40, fontFamily: '"Georgia"' } });
    const render = createDanmakuMessageRenderer({ document, style: 'animated-gradient', classNames: DEFAULT_DANMAKU_CLASSES });
    const result = [];
    for (const kind of ['danmaku', 'gift', 'superchat']) {
      const card = render({ kind, name: '很长的观众昵称也要完整显示', message: kind === 'superchat' ? '完整原文\n第二行' : '[星][星]',
        roomGuardLevel: 3, roomMedal: { name: '星旅', level: 12 }, giftName: '很长的礼物名称', giftCount: 3,
        giftTotalPrice: 20000, price: 20000,
        emotes: [{ text: '[星]', url: '/img/overlays/danmaku-previews/dacall.png', kind: 'inline' }] });
      document.getElementById('feed').replaceChildren(card);
      await Promise.all(Array.from(card.querySelectorAll('img')).map(image => image.decode()));
      const content = card.querySelector(kind === 'gift' ? '.gradient-gift-name' : '.gradient-copy');
      const bounds = card.getBoundingClientRect();
      const amount = card.querySelector('.gradient-amount');
      const ticketBounds = card.querySelector('.gradient-ticket')?.getBoundingClientRect();
      const amountBounds = amount?.getBoundingClientRect();
      const amountRange = document.createRange();
      if (amount) amountRange.selectNodeContents(amount);
      result.push({ kind, fits: card.scrollWidth <= card.clientWidth + 1
        && Array.from(card.querySelectorAll('.gradient-heading,.gradient-panel,.gradient-event-label,img')).every(node => {
          const box = node.getBoundingClientRect();
          return box.left >= bounds.left - 1 && box.right <= bounds.right + 1;
        }), size: parseFloat(getComputedStyle(content).fontSize), family: getComputedStyle(content).fontFamily,
        amount: amount?.textContent, amountSize: amount ? parseFloat(getComputedStyle(amount).fontSize) : 0,
        amountFits: !amount || amountBounds.left >= ticketBounds.left && amountBounds.right <= ticketBounds.right,
        amountLines: amount ? amountRange.getClientRects().length : 0, copy: content.textContent });
    }
    return result;
  });
  for (const result of results) {
    assert.ok(result.fits, `${result.kind} fits without clipping text, emotes or amounts`);
    assert.ok(Math.abs(result.size - 40 * (result.kind === 'gift' ? 13 / 19 : 1)) < .01);
    assert.match(result.family, /Georgia/);
    if (result.kind !== 'danmaku') {
      assert.equal(result.amount, ' · ¥20,000');
      assert.ok(Math.abs(result.amountSize - 40 * 17 / 19) < .01, 'paid sender and amount scale with body text');
      assert.equal(result.amountLines, 1, 'paid amount remains readable on one line');
      assert.ok(result.amountFits, 'paid amount stays inside its event frame');
    }
    if (result.kind === 'superchat') assert.equal(result.copy, '完整原文\n第二行');
  }
});

test('wireframe keeps paid-message amounts and copy inside a narrow region at the chosen font size', async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/danmaku.css">
    <body data-style="wireframe"><div class="danmaku-signal-stage" style="width:320px;height:900px">
      <div id="feed" class="draw-danmaku-feed"></div>
    </div></body>` });
  t.after(() => fixture.close());
  const session = openBrowserSession();
  t.after(() => session.close());
  const page = await session.newPage({ viewport: { width: 640, height: 960 } });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const results = await page.evaluate(async () => {
    const { createDanmakuMessageRenderer, DEFAULT_DANMAKU_CLASSES } = await import('/js/overlays/danmaku-message-renderer.js');
    const { applyStyleOptions } = await import('/js/overlays/danmaku-style-application.js');
    applyStyleOptions(document, 'wireframe', { wireframe: { fontSize: 48, fontFamily: '"Georgia"' } });
    const render = createDanmakuMessageRenderer({ document, style: 'wireframe', classNames: DEFAULT_DANMAKU_CLASSES });
    const root = document.getElementById('feed');
    return ['gift', 'superchat'].map(kind => {
      const card = render({ kind, name: '很长的观众昵称也不能挤走金额', message: '完整留言',
        giftName: '星愿', giftCount: 3, giftTotalPrice: 20000, price: 20000 });
      root.replaceChildren(card);
      const amount = card.querySelector('.wireframe-amount');
      const copy = card.querySelector('.wireframe-copy');
      const bounds = card.getBoundingClientRect();
      return { kind, width: card.clientWidth, contentWidth: card.scrollWidth, amount: amount.textContent,
        amountVisible: amount.getBoundingClientRect().left >= bounds.left && amount.getBoundingClientRect().right <= bounds.right,
        font: getComputedStyle(copy).fontSize, family: getComputedStyle(copy).fontFamily, copy: copy.textContent };
    });
  });
  for (const result of results) {
    assert.ok(result.contentWidth <= result.width + 1 && result.amountVisible, `${result.kind} keeps its details inside the component`);
    assert.equal(result.amount, 'CN¥20,000.0');
    assert.equal(result.font, '48px', 'fitting the amount does not shrink the chosen body text');
    assert.match(result.family, /Georgia/);
    assert.ok(result.copy.includes(result.kind === 'gift' ? '星愿' : '完整留言'));
  }
});

test('Glass event text follows the component scale without a second SC zoom', async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/danmaku.css">
    <div class="danmaku-canvas-space"><div class="danmaku-canvas"><div class="danmaku-region">
      <div class="danmaku-signal-stage"><div id="feed" class="draw-danmaku-feed"></div></div>
    </div></div></div>` });
  t.after(() => fixture.close());
  const session = openBrowserSession();
  t.after(() => session.close());
  const page = await session.newPage({ viewport: { width: 1920, height: 1080 } });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const results = await page.evaluate(async () => {
    const { applyStyleOptions } = await import('/js/overlays/danmaku-style-application.js');
    const { createLayout } = await import('/js/shared/danmaku-layout.js');
    const { applyCanvas } = await import('/js/overlays/danmaku-canvas.js');
    const { createDanmakuMessageRenderer, DEFAULT_DANMAKU_CLASSES } = await import('/js/overlays/danmaku-message-renderer.js');
    document.body.dataset.style = 'glass';
    const render = createDanmakuMessageRenderer({ document, style: 'glass', classNames: DEFAULT_DANMAKU_CLASSES });
    const root = document.getElementById('feed');
    const result = [];
    for (const fontSize of [22, 32]) {
      applyStyleOptions(document, 'glass', { glass: { fontSize, fontFamily: '"Georgia"' } });
      root.replaceChildren(render({ name: '普通观众', message: '普通消息' }),
        render({ kind: 'gift', name: '礼物观众', giftName: '小花花', giftCount: 1 }),
        render({ kind: 'superchat', name: '留言观众', message: '完整留言', price: 30 }));
      for (const scale of [1, 0.75]) {
        const layout = createLayout();
        layout.regions.glass.width *= scale;
        layout.regions.glass.height *= scale;
        applyCanvas(document, layout, 'glass', 1920, 1080);
        for (const card of root.children) {
          const copy = card.querySelector('.glass-copy');
          const probe = document.createElement('span');
          probe.style.cssText = 'position:absolute;display:block;width:1em;height:1em';
          copy.append(probe);
          result.push({ kind: card.dataset.glassKind, fontSize, scale,
            paintedEm: probe.getBoundingClientRect().width, family: getComputedStyle(copy).fontFamily });
          probe.remove();
        }
      }
    }
    return result;
  });
  for (const result of results) {
    const ratio = result.kind === 'chat' ? 1 : 12 / 11;
    assert.ok(Math.abs(result.paintedEm - result.fontSize * result.scale * ratio) < 0.1, JSON.stringify(result));
    assert.match(result.family, /Georgia/);
  }
});

test('dark moon keeps inline and standalone emotes inside its revealed copy', async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/danmaku.css">
    <body data-style="dark-moon"><div id="feed" class="draw-danmaku-feed" style="width:388px;height:840px"></div></body>` });
  const session = openBrowserSession();
  t.after(async () => { await session.close(); await fixture.close(); });
  const page = await session.newPage({ viewport: { width: 420, height: 900 }, reducedMotion: 'reduce' });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const measurements = await page.evaluate(async () => {
    const { applyStyleOptions } = await import('/js/overlays/danmaku-style-application.js');
    const { createDanmakuMessageRenderer, DEFAULT_DANMAKU_CLASSES } = await import('/js/overlays/danmaku-message-renderer.js');
    const render = createDanmakuMessageRenderer({ document, style: 'dark-moon', classNames: DEFAULT_DANMAKU_CLASSES,
      resolveEmoteUrl: value => value });
    const results = [];
    for (const fontSize of [18, 40]) for (const message of ['你好[星]', '[星]']) {
      applyStyleOptions(document, 'dark-moon', { 'dark-moon': { fontSize } });
      const card = render({ name: '观众', message,
        emotes: [{ text: '[星]', url: '/img/overlays/danmaku-previews/dacall.png', kind: 'inline' }] });
      document.getElementById('feed').replaceChildren(card);
      const image = card.querySelector('.draw-danmaku-emote');
      await image.decode();
      const bounds = image.getBoundingClientRect();
      const copy = card.querySelector('.dark-moon-copy').getBoundingClientRect();
      results.push({ fontSize, message, contained: bounds.top >= copy.top - .1 && bounds.bottom <= copy.bottom + .1
        && bounds.left >= copy.left - .1 && bounds.right <= copy.right + .1 });
    }
    return results;
  });
  for (const result of measurements) assert.ok(result.contained, JSON.stringify(result));
});

test('each style applies chosen text sizes and fonts through canvas scaling', async t => {
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
    const { DANMAKU_STYLE_OPTIONS } = await import('/js/shared/danmaku-style-options.js');
    const { applyStyleOptions } = await import('/js/overlays/danmaku-style-application.js');
    const { createLayout } = await import('/js/shared/danmaku-layout.js');
    const { applyCanvas } = await import('/js/overlays/danmaku-canvas.js');
    const { createDanmakuMessageRenderer, DEFAULT_DANMAKU_CLASSES } = await import('/js/overlays/danmaku-message-renderer.js');
    const root = document.getElementById('feed');
    const results = [];
    for (const [style, limits] of Object.entries(DANMAKU_STYLE_OPTIONS)) {
      document.body.dataset.style = style;
      const render = createDanmakuMessageRenderer({ document, style, classNames: DEFAULT_DANMAKU_CLASSES });
      const sender = { name: '观众', roomGuardLevel: 3, honorLevel: 20, roomMedal: { name: '粉丝牌', level: 12 } };
      const messages = [
        { ...sender, message: '正文大小' },
        { ...sender, kind: 'gift', giftName: '礼物', giftCount: 2, giftTotalPrice: 30 },
      ];
      const hasSuperchat = limits.scrollDirection || limits.layout === 'horizontal' || ['mist', 'comic', 'stardust', 'glass-bubble'].includes(style);
      if (hasSuperchat) messages.push({ ...sender, kind: 'superchat', message: '留言大小', price: 30 });
      for (const fontSize of [limits.minFontSize, limits.maxFontSize]) {
        applyStyleOptions(document, style, { [style]: { fontSize, fontFamily: '"Georgia"' } });
        root.replaceChildren(...messages.map(render));
        const cards = Array.from(root.children);
        const paragraph = (card, text) => Array.from(card.querySelectorAll('p')).find(node => node.textContent === text);
        const giftSelector = style === 'animated-gradient' ? '.gradient-gift-name'
          : style === 'celestial-horizontal' ? '.celestial-copy'
          : ['sea-breeze', 'sea-breeze-random'].includes(style) ? '.sea-breeze-copy'
          : style === 'dark-moon' ? '.dark-moon-event-label' : style === 'wireframe' ? '.wireframe-copy' : style === 'ripploid' ? '.ripploid-gift-name'
          : style === 'flower-letter' ? '.flower-gift-name'
            : style === 'christmas' ? '.christmas-gift-name'
            : style === 'christmas-letter' ? '.xletter-gift-name'
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
            results.push({ style, fontSize, scale, kind, width: probe.getBoundingClientRect().width,
              family: getComputedStyle(node).fontFamily,
              ...(kind === 'superchat' && ['snowfox', 'moonlit'].includes(style)
                ? { nameFamily: getComputedStyle(cards[2].querySelector('.sc-name')).fontFamily } : {}),
              ...(kind === 'gift' && style === 'dark-moon'
                ? { nameFamily: getComputedStyle(cards[1].querySelector('.dark-moon-name')).fontFamily } : {}) });
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
    if (style !== 'ripploid' || kind !== 'gift') assert.match(result.family, /Georgia/, `${key} applies the selected font`);
    if (result.nameFamily) assert.match(result.nameFamily, /Georgia/, `${key} sender applies the selected font`);
    const nativeLettering = style === 'flower-letter'
      || kind === 'superchat' && ['ripploid', 'notebook'].includes(style)
      || kind === 'gift' && ['ripploid', 'spooky'].includes(style);
    const roleScale = style === 'animated-gradient' && kind === 'gift' ? 13 / 19
      : style === 'dark-moon' && kind === 'gift' ? 0.88 : style === 'christmas' && kind === 'gift' ? 0.92
      : style === 'glass' && kind !== 'chat' ? 12 / 11 : 1;
    const fontOffset = style === 'stardust' && kind !== 'chat' ? 2 : 0;
    if (!nativeLettering) assert.ok(Math.abs(width - (fontSize + fontOffset) * scale * roleScale) <= 0.1, JSON.stringify(result));
    if (!baselines.has(key)) baselines.set(key, result);
    const baseline = baselines.get(key);
    // RIPPLOID's gift ticket owns fixed lettering; chat and SC still use the text setting.
    const fontScale = style === 'ripploid' && kind === 'gift' ? 1 : (fontSize + fontOffset) / (baseline.fontSize + fontOffset);
    const expected = baseline.width * fontScale * scale;
    assert.ok(Math.abs(width - expected) <= 0.1, JSON.stringify({ ...result, expected }));
  }
});
