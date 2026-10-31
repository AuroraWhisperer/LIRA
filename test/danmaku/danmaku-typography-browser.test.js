'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

test('custom bubble background leaves a standalone Super Chat shell unchanged', async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/danmaku.css">
    <div id="chat" class="draw-danmaku-item">普通弹幕</div>
    <div id="sc" class="draw-danmaku-item is-superchat">SC</div>` });
  t.after(() => fixture.close());
  const session = openBrowserSession();
  t.after(() => session.close());
  const page = await session.newPage();
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const styles = await page.evaluate(() => {
    document.body.dataset.style = 'bubble';
    const read = () => Object.fromEntries(['chat', 'sc'].map(id => {
      const css = getComputedStyle(document.getElementById(id));
      return [id, { image: css.backgroundImage, color: css.backgroundColor }];
    }));
    const before = read();
    document.body.dataset.customBackground = 'true';
    document.documentElement.style.setProperty('--danmaku-background-opacity', '0.5');
    return { before, after: read() };
  });
  assert.deepEqual(styles.after.sc, styles.before.sc);
  assert.notDeepEqual(styles.after.chat, styles.before.chat);
});

test('notebook chat fits its content while event cards fill the region and center only regular gift thanks', async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/danmaku.css">
    <div class="danmaku-canvas-space"><div class="danmaku-canvas"><div class="danmaku-region">
      <div class="danmaku-signal-stage"><div id="feed" class="draw-danmaku-feed"></div></div>
    </div></div></div>` });
  t.after(() => fixture.close());
  const session = openBrowserSession();
  t.after(() => session.close());
  const page = await session.newPage({ viewport: { width: 640, height: 1440 }, reducedMotion: 'reduce' });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const results = await page.evaluate(async () => {
    const { applyStyleOptions } = await import('/js/shared/danmaku-style-options.js');
    const { createLayout } = await import('/js/shared/danmaku-layout.js');
    const { applyCanvas } = await import('/js/overlays/danmaku-canvas.js');
    const { createDanmakuMessageRenderer, DEFAULT_DANMAKU_CLASSES } = await import('/js/overlays/danmaku-message-renderer.js');
    document.body.dataset.style = 'notebook';
    const layout = createLayout();
    layout.canvas = { width: 640, height: 1440 };
    layout.regions.notebook = { x: 0, y: 0, width: 640, height: 1440 };
    applyCanvas(document, layout, 'notebook', 640, 1440);
    const feed = document.getElementById('feed');
    const messages = [
      { name: '阿哲', message: '来了' },
      { name: '小眠Mio', message: '再来一首'.repeat(20) },
      { kind: 'gift', name: '观众', giftName: '小花花', giftCount: 5, giftTotalPrice: 9.9 },
      { kind: 'gift', name: '观众', giftGuardLevel: 3, guardAction: 'open', giftCount: 1 },
      { kind: 'superchat', name: '阿哲', message: '再来一首'.repeat(10), price: 2000 },
    ];
    function lineCount(node) {
      const range = document.createRange();
      range.selectNodeContents(node);
      return new Set(Array.from(range.getClientRects(), rect => Math.round(rect.top))).size;
    }
    const measurements = [];
    for (const showAvatar of [true, false]) {
      const render = createDanmakuMessageRenderer({ document, style: 'notebook', showAvatar, classNames: DEFAULT_DANMAKU_CLASSES });
      for (const fontSize of [18, 23, 48]) {
        applyStyleOptions(document, 'notebook', { notebook: { fontSize } });
        feed.replaceChildren(...messages.map(render));
        await document.fonts.ready;
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const bounds = feed.getBoundingClientRect();
        const padding = getComputedStyle(feed);
        const width = bounds.width - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
        measurements.push({ showAvatar, fontSize, width,
          cards: Array.from(feed.children, card => {
            const rect = card.getBoundingClientRect();
            const copy = card.querySelector('.notebook-copy');
            const copyBounds = copy.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(copy);
            const textBounds = range.getBoundingClientRect();
            return { kind: card.dataset.notebookKind, width: rect.width,
              paperRight: card.querySelector('.notebook-paper-float').getBoundingClientRect().right,
              right: rect.right,
              textLeftOffset: textBounds.left - copyBounds.left,
              textCenterOffset: textBounds.left + textBounds.width / 2 - copyBounds.left - copyBounds.width / 2,
            };
          }),
          shortLines: lineCount(feed.children[0].querySelector('.notebook-copy')),
          longLines: lineCount(feed.children[1].querySelector('.notebook-copy')),
        });
      }
    }
    return measurements;
  });
  for (const result of results) {
    assert.equal(result.shortLines, 1, JSON.stringify(result));
    assert.ok(result.longLines > 1, JSON.stringify(result));
    assert.ok(result.cards[0].width < result.cards[1].width, JSON.stringify(result));
    assert.ok(Math.abs(result.cards[1].width - result.width) < 1, JSON.stringify(result));
    for (const card of result.cards.filter(card => card.kind !== 'chat')) {
      assert.ok(Math.abs(card.width - result.width) < 1, JSON.stringify({ ...result, card }));
      if (card.kind === 'gift') {
        assert.ok(Math.abs(card.textCenterOffset) < 1, JSON.stringify({ ...result, card }));
      } else if (card.kind === 'member') {
        assert.ok(Math.abs(card.textLeftOffset) < 1, JSON.stringify({ ...result, card }));
      }
    }
    for (const card of result.cards) {
      assert.ok(Math.abs(card.paperRight - card.right) < 1, JSON.stringify({ ...result, card }));
    }
  }
});

test('each style changes body text independently of identity and artwork while retaining canvas scaling', async t => {
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
      const sender = { name: '观众', roomGuardLevel: 3, honorLevel: 20, roomMedal: { name: '粉丝牌', level: 12 } };
      const messages = [
        { ...sender, message: '正文大小' },
        { ...sender, kind: 'gift', giftName: '礼物', giftCount: 2, giftTotalPrice: 30 },
      ];
      const hasSuperchat = limits.scrollDirection || style === 'mist';
      if (hasSuperchat) messages.push({ ...sender, kind: 'superchat', message: '留言大小', price: 30 });
      messages.push({ ...sender, kind: 'gift', giftGuardLevel: 3, guardAction: 'open', giftCount: 1 });
      messages.push({ ...sender, message: '行内[星]', emotes: [{ text: '[星]', url: '/img/overlays/danmaku-notebook/bilibili-noface.jpg', kind: 'inline' }] });
      for (const fontSize of [limits.defaultFontSize || 30, limits.minFontSize, limits.maxFontSize]) {
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
          const emote = cards.at(-1).querySelector('.draw-danmaku-emote');
          results.push({ style, fontSize, scale, kind: 'emote', width: emote.getBoundingClientRect().height });
          const names = root.querySelectorAll('.draw-danmaku-identity strong, .sc-name, .spooky-event-name, .flower-nickname, .prismatic-guard-name, .mist-guard-name, .harbor-guard-name, .snowfox-member-name');
          const artwork = root.querySelectorAll('.draw-danmaku-avatar, .sc-avatar, .spooky-portrait, .spooky-sticker, .notebook-avatar-frame, .notebook-tape, .harbor-avatar-frame, .prismatic-honor, .prismatic-guard, .notebook-guard, .snowfox-guard');
          const badges = root.querySelectorAll('.draw-danmaku-medal, .prismatic-medal, .snowfox-medal');
          const amounts = root.querySelectorAll('.sc-money, .draw-danmaku-gift-amount, .spooky-sc .spooky-event-copy, .notebook-amount, .twitter-gift-total, .flower-price');
          const identity = [...names, ...badges, ...amounts].map(node => {
            const css = getComputedStyle(node);
            return node.getClientRects().length && css.display !== 'none' ? css.fontSize : null;
          });
          const decorations = [...artwork].map(node => {
            const css = getComputedStyle(node);
            return node.getClientRects().length && css.display !== 'none' ? [css.width, css.height] : null;
          });
          results.push({ style, fontSize, scale, kind: 'identity', identity, decorations });
        }
      }
    }
    return results;
  });
  const baselines = new Map();
  for (const result of measurements) {
    const { style, fontSize, scale, kind, width } = result;
    const key = `${style}:${kind}`;
    if (kind === 'identity') {
      const identityKey = `${key}:${scale}`;
      if (!baselines.has(identityKey)) baselines.set(identityKey, result);
      const baseline = baselines.get(identityKey);
      assert.deepEqual(result.identity, baseline.identity, `${style}: body size must preserve sender, badge and amount typography`);
      assert.deepEqual(result.decorations, baseline.decorations, `${style}: body size must preserve avatars, frames and artwork`);
      continue;
    }
    assert.ok(Number.isFinite(width) && width > 0, `${key} renders visible text`);
    const nativeLettering = style === 'flower-letter'
      || kind === 'superchat' && ['ripploid', 'notebook'].includes(style)
      || kind === 'gift' && ['ripploid', 'spooky'].includes(style);
    if (!nativeLettering && kind !== 'emote') {
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
