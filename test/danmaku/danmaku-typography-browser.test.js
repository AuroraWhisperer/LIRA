'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

test('coffee writing preserves complete text, emoji and failed emotes through entry and reduced motion', async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/danmaku.css">
    <body data-style="coffee"><div class="danmaku-signal-stage"><div id="feed" class="draw-danmaku-feed"></div></div></body>` });
  const session = openBrowserSession();
  t.after(async () => { await session.close(); await fixture.close(); });
  const page = await session.newPage({ viewport: { width: 400, height: 640 } });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async () => {
    const { createDanmakuFeed } = await import('/js/overlays/danmaku-feed.js');
    const { applyStyleOptions } = await import('/js/overlays/danmaku-style-application.js');
    applyStyleOptions(document, 'coffee', {});
    window.feed = createDanmakuFeed(document.getElementById('feed'), { style: 'coffee', offscreenViewports: 0 });
    window.message = 'A👩‍👩‍👧‍👦é <b>完整原文</b> [星]';
    window.feed.append({ id: 'writing', name: '观众', message: window.message,
      emotes: [{ text: '[星]', url: '/missing-coffee-emote.png', kind: 'inline' }] });
  });
  await page.waitForFunction(() => !document.querySelector('.coffee-copy img'));
  const result = await page.evaluate(() => {
    const copy = document.querySelector('.coffee-copy');
    const clusterIntact = [...copy.querySelectorAll('.coffee-glyph')].some(node => node.textContent === '👩‍👩‍👧‍👦');
    const textSafe = copy.textContent === window.message && !copy.querySelector('b');
    for (const animation of document.getAnimations()) {
      if (animation.effect.getComputedTiming().iterations !== Infinity) animation.finish();
    }
    return { clusterIntact, textSafe };
  });
  assert.ok(result.clusterIntact && result.textSafe, 'typing never splits emoji, parses markup or loses fallback text');
  await page.waitForFunction(() => !document.querySelector('[data-live-entry]'));
  assert.equal(await page.locator('.coffee-copy').evaluate(copy => [...copy.querySelectorAll('.coffee-glyph')]
    .every(node => getComputedStyle(node).opacity === '1')), true, 'all text remains visible after entry ends');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await page.evaluate(() => {
    const message = '完整长留言\n'.repeat(15);
    window.feed.render([]);
    window.feed.append({ id: 'paid', kind: 'superchat', name: '留言者', message, price: 50 });
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
      const copy = document.querySelector('.coffee-copy');
      const card = document.querySelector('.coffee-item');
      const result = { complete: copy.textContent === message,
        visible: [...copy.querySelectorAll('.coffee-glyph')].every(node => getComputedStyle(node).opacity === '1'),
        contained: card.scrollWidth <= card.clientWidth + 1,
        price: document.querySelector('.coffee-price').textContent.includes('50') };
      window.feed.destroy();
      resolve(result);
    })));
  });
  assert.ok(reduced.complete && reduced.visible && reduced.contained && reduced.price, 'reduced motion preserves the full paid message');
});

test('coffee events keep settled gift totals and purchased membership details without duplicate amounts', async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/danmaku.css">
    <body data-style="coffee"><div class="danmaku-signal-stage"><div id="feed" class="draw-danmaku-feed"></div></div></body>` });
  const session = openBrowserSession();
  t.after(async () => { await session.close(); await fixture.close(); });
  const page = await session.newPage({ viewport: { width: 400, height: 640 }, reducedMotion: 'reduce' });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const results = await page.evaluate(async () => {
    const { createDanmakuMessageRenderer, DEFAULT_DANMAKU_CLASSES } = await import('/js/overlays/danmaku-message-renderer.js');
    const { applyStyleOptions } = await import('/js/overlays/danmaku-style-application.js');
    applyStyleOptions(document, 'coffee', {});
    const render = createDanmakuMessageRenderer({ document, style: 'coffee', showGiftTotal: true,
      classNames: DEFAULT_DANMAKU_CLASSES });
    return [
      { giftName: '<b>星愿礼物</b>', giftCount: 66, giftTotalPrice: 13.2 },
      { giftGuardLevel: 3, guardAction: 'open', giftCount: 1, giftTotalPrice: 138, guardAccompanyDays: 1 },
      { giftGuardLevel: 2, guardAction: 'renew', giftCount: 3, giftTotalPrice: 5994, guardAccompanyDays: 360 },
      { giftGuardLevel: 1, giftCount: 1 },
      { giftName: '免费礼物', giftCount: 2, giftTotalPrice: 0 },
    ].map(item => {
      const card = render({ kind: 'gift', name: '一位昵称很长的观众也要看清礼物金额', roomGuardLevel: 2, ...item });
      document.getElementById('feed').replaceChildren(card);
      const copy = card.querySelector('.coffee-copy');
      const price = card.querySelector('.coffee-price');
      const bounds = card.getBoundingClientRect();
      const priceBounds = price?.getBoundingClientRect();
      return { copy: copy.textContent, count: copy.querySelector('.draw-danmaku-gift-count').textContent,
        name: copy.querySelector('.draw-danmaku-gift-name').textContent,
        markupParsed: !!copy.querySelector('.draw-danmaku-gift-name b'),
        amount: price?.textContent, amountCopies: (card.textContent.match(/CN¥/g) || []).length,
        role: card.querySelector('.coffee-role')?.getAttribute('aria-label'), note: card.querySelector('.coffee-event-note')?.textContent,
        fits: card.scrollWidth <= card.clientWidth + 1 && (!priceBounds || priceBounds.left >= bounds.left && priceBounds.right <= bounds.right) };
    });
  });
  assert.equal(results[0].name, '<b>星愿礼物</b>');
  assert.equal(results[0].markupParsed, false, 'gift names remain literal text');
  assert.match(results[0].count, /66/);
  assert.equal(results[0].amount, 'CN¥13.20', 'use the settled total without multiplying by quantity');
  assert.equal(results[1].role, '舰长', 'membership badge follows the purchased tier');
  assert.match(results[1].copy, /开通\s*舰长/);
  assert.match(results[2].copy, /续费\s*提督/);
  assert.match(results[2].count, /3/);
  assert.match(results[2].note, /360/);
  assert.equal(results[3].role, '总督');
  assert.match(results[3].copy, /支持\s*总督/, 'unknown membership actions do not claim a new purchase');
  assert.equal(results[3].amount, undefined, 'an absent amount is not a fabricated zero');
  assert.equal(results[4].amount, 'CN¥0.00', 'a known free gift retains its actual total');
  for (const [index, result] of results.entries()) {
    assert.equal(result.amountCopies, index === 3 ? 0 : 1, 'gift amounts render once');
    assert.ok(result.fits, 'long sender names cannot push event amounts outside the card');
  }
});

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
        }), amount: amount?.textContent,
        amountFits: !amount || amountBounds.left >= ticketBounds.left && amountBounds.right <= ticketBounds.right,
        amountLines: amount ? amountRange.getClientRects().length : 0, copy: content.textContent });
    }
    return result;
  });
  for (const result of results) {
    assert.ok(result.fits, `${result.kind} fits without clipping text, emotes or amounts`);
    if (result.kind !== 'danmaku') {
      assert.equal(result.amount, ' · ¥20,000');
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

test('prismatic and snowfox reflow paid cards when the feed region shrinks', async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/danmaku.css">
    <style>*, *::before, *::after { transition: none !important; }</style>
    <div class="danmaku-signal-stage" style="width:440px;height:180px">
      <div id="feed" class="draw-danmaku-feed"></div>
    </div>` });
  const session = openBrowserSession();
  t.after(async () => { await session.close(); await fixture.close(); });
  const page = await session.newPage({ viewport: { width: 640, height: 480 }, reducedMotion: 'reduce' });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const results = await page.evaluate(async () => {
    const { createDanmakuFeed } = await import('/js/overlays/danmaku-feed.js');
    const root = document.getElementById('feed');
    const results = [];
    for (const style of ['prismatic', 'snowfox']) {
      document.body.dataset.style = style;
      for (const item of [
        { kind: 'superchat', name: '留言者', price: 30, message: '完整的长留言内容\n'.repeat(16) },
        { kind: 'gift', name: '完整守护者'.repeat(18), giftGuardLevel: 3, giftCount: 1, giftTotalPrice: 138 },
      ]) {
        root.parentElement.style.height = '2000px';
        const feed = createDanmakuFeed(root, { style, offscreenViewports: 0, autoScroll: false });
        feed.render([item]);
        await document.fonts.ready;
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const original = root.firstElementChild;
        const before = { width: original.offsetWidth, height: original.offsetHeight,
          fontSize: Number.parseFloat(getComputedStyle(original).fontSize), text: original.textContent };
        root.parentElement.style.height = '180px';
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const fitted = root.firstElementChild;
        const bounds = fitted.getBoundingClientRect();
        results.push({ style, kind: item.kind, before, availableHeight: root.clientHeight,
          width: bounds.width, height: bounds.height, text: fitted.textContent,
          fontSize: Number.parseFloat(getComputedStyle(fitted).fontSize) });
        feed.destroy();
      }
    }
    return results;
  });
  for (const result of results) {
    const label = `${result.style} ${result.kind}`;
    assert.ok(result.before.height > result.availableHeight, `${label} requires fitting: ${result.before.height} > ${result.availableHeight}`);
    assert.ok(result.fontSize > 0 && result.fontSize < result.before.fontSize, `${label} reflows at a smaller type size`);
    assert.ok(Math.abs(result.width - result.before.width) < 1,
      `${label} retains its full panel width: ${result.before.width} -> ${result.width}`);
    assert.ok(result.height <= result.availableHeight, `${label} fits inside the feed`);
    assert.equal(result.text, result.before.text, `${label} retains all event content`);
  }
});

test('style text responds to chosen fonts and sizes; representative layouts retain canvas scaling', async t => {
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
    const { applyCanvas, canvasContentScale } = await import('/js/overlays/danmaku-canvas.js');
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
          // The shared canvas covers fixed, horizontal and moving layouts once.
          if (scale !== 1 && !['signal', 'glass', 'celestial-horizontal', 'floating'].includes(style)) continue;
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
            const senderStyle = style === 'astral' && kind !== 'chat'
              ? getComputedStyle(cards[kind === 'gift' ? 1 : 2].querySelector('.astral-name')) : null;
            results.push({ style, fontSize, scale, kind, width: probe.getBoundingClientRect().width,
              contentScale: canvasContentScale(layout, style),
              family: getComputedStyle(node).fontFamily,
              ...(senderStyle ? { nameFamily: senderStyle.fontFamily } : {}),
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
    if (style === 'signal' && kind === 'chat') {
      assert.ok(Math.abs(width - fontSize * result.contentScale) <= 0.1, 'the selected body size reaches the rendered text');
    }
    if (!baselines.has(key)) baselines.set(key, result);
    const baseline = baselines.get(key);
    // Event lettering may own its proportions; changing that design must not break this settings check.
    if (fontSize > baseline.fontSize && (style !== 'ripploid' || kind !== 'gift')) {
      assert.ok(width / scale > baseline.width, `${key} grows when the chosen font size increases`);
    }
    const sizeKey = `${key}:${fontSize}`;
    if (scale === 1) baselines.set(sizeKey, result);
    else assert.ok(Math.abs(width - baselines.get(sizeKey).width * scale) <= 0.1,
      `${key} follows the canvas scale at font size ${fontSize}`);
  }
});
