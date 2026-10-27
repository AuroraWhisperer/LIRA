'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { DANMAKU_STYLE_OPTIONS } = require('../../src/shared/danmaku-style-options');

const openBrowserSession = useSharedBrowser();
const styledMotion = Object.keys(DANMAKU_STYLE_OPTIONS)
  .filter(style => DANMAKU_STYLE_OPTIONS[style].scrollDirection && style !== 'moonlit');

test('notebook pauses old paper independently, keeps emotes static and renders event avatars inside their frames', { timeout: 15000 }, async t => {
  const page = await preview(t, 'up', 1, 'notebook');
  await page.evaluate(() => {
    feed.render([]);
    feed.append({ id: 'notebook-chat', name: '观众', message: '[表情]', roomGuardLevel: 1,
      avatarUrl: '/img/overlays/danmaku-notebook/bilibili-noface.jpg',
      emotes: [{ text: '[表情]', url: '/img/overlays/danmaku-notebook/bilibili-noface.jpg', width: 180, height: 180 }] });
  });
  await page.waitForFunction(() => root.querySelector('.notebook-item') && !root.querySelector('[data-live-entry]'));
  const before = await page.locator('.notebook-item').evaluate(node => {
    const paper = node.querySelector('.notebook-paper-float');
    const avatar = node.querySelector('.notebook-portrait-sway');
    return { paperTime: paper.getAnimations()[0].currentTime, avatarTime: avatar.getAnimations()[0].currentTime,
      emoteAnimations: node.querySelector('.draw-danmaku-emote').getAnimations().length,
      paperState: getComputedStyle(paper).animationPlayState,
      headingOpacity: getComputedStyle(node.querySelector('.notebook-heading')).opacity,
      bodyOpacity: getComputedStyle(node.querySelector('.notebook-copy')).opacity };
  });
  assert.equal(before.paperState, 'running');
  assert.equal(before.emoteAnimations, 0);
  assert.equal(before.headingOpacity, '1');
  assert.equal(before.bodyOpacity, '1');
  await page.evaluate(() => feed.append({ id: 'notebook-gift', kind: 'gift', name: '送礼者',
    giftName: '小花', giftCount: 2, giftTotalPrice: 9.9 }));
  await page.waitForFunction(previous => root.querySelector('.notebook-portrait-sway').getAnimations()[0].currentTime > previous + 100, before.avatarTime);
  const paused = await page.locator('.notebook-item').first().evaluate(node => ({
    paperTime: node.querySelector('.notebook-paper-float').getAnimations()[0].currentTime,
    state: getComputedStyle(node.querySelector('.notebook-paper-float')).animationPlayState,
  }));
  assert.equal(paused.state, 'paused');
  await page.waitForFunction(() => !root.querySelector('[data-live-entry]'));
  const settled = await page.evaluate(() => {
    const old = root.querySelector('.notebook-item');
    const gift = root.querySelector('[data-notebook-kind="gift"]');
    const avatar = gift.querySelector('.notebook-avatar');
    return { paperTime: old.querySelector('.notebook-paper-float').getAnimations()[0].currentTime,
      giftDisplay: getComputedStyle(gift).display, giftBackground: getComputedStyle(gift).backgroundImage,
      avatarFont: parseFloat(getComputedStyle(avatar).fontSize), avatarHeight: avatar.getBoundingClientRect().height,
      amount: gift.querySelector('.notebook-amount').textContent };
  });
  assert.ok(Math.abs(settled.paperTime - paused.paperTime) < 2);
  assert.equal(settled.giftDisplay, 'flex');
  assert.equal(settled.giftBackground, 'none');
  assert.ok(settled.avatarFont > 0);
  assert.ok(settled.avatarHeight > 20);
  assert.equal(settled.amount, 'CN¥9.9');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => root.getAnimations({ subtree: true }).length === 0);
  const snapshot = await page.evaluate(() => {
    feed.render([{ name: '重建快照', message: '直接显示完整正文。' }]);
    return { entries: root.querySelectorAll('[data-live-entry]').length,
      opacity: getComputedStyle(root.querySelector('.notebook-copy')).opacity };
  });
  assert.deepEqual(snapshot, { entries: 0, opacity: '1' });
  const longNames = await page.evaluate(() => {
    const name = '十六个汉字组成的最长直播观众昵称';
    feed.render([{ name, message: '短正文', roomGuardLevel: 1 },
      { kind: 'gift', name, giftName: '超长礼物名称也应该完整显示', giftCount: 99, giftTotalPrice: 123456.78 }]);
    return [...root.querySelectorAll('.notebook-name')].map(node => ({ text: node.textContent,
      overflow: getComputedStyle(node).textOverflow, clipped: node.scrollWidth > node.clientWidth + 1 }));
  });
  assert.equal(longNames.length, 2);
  assert.ok(longNames.every(name => name.overflow !== 'ellipsis' && !name.clipped));
});

test('spooky preserves fades and finishes without a raster change inside a scaled canvas iframe', { timeout: 15000 }, async t => {
  const page = await preview(t, 'up', 1, 'spooky');
  await page.setViewportSize({ width: 640, height: 700 });
  await page.evaluate(async () => {
    feed.destroy();
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width:530px;height:620px;border:0;transform:scale(.925);transform-origin:top left';
    const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
    frame.src = location.href;
    document.body.replaceChildren(frame);
    await loaded;
  });
  const frame = page.frames().find(candidate => candidate.parentFrame());
  await frame.evaluate(async () => {
    Object.assign(document.querySelector('.danmaku-signal-stage').style, { width: '530px', height: '620px' });
    const { applyStyleOptions } = await import('/js/shared/danmaku-style-options.js');
    applyStyleOptions(document, 'spooky', {});
    const { createDanmakuFeed } = await import('/js/overlays/danmaku-feed.js');
    window.root = document.getElementById('feed');
    window.feed = createDanmakuFeed(root, { style: 'spooky', offscreenViewports: 0, autoScroll: false });
  });
  const clip = await page.locator('iframe').boundingBox();
  for (const item of [
    { name: '聊天者', message: '好耶！今天的歌很好听～' },
    { kind: 'gift', name: '送礼者', giftName: '小花花', giftCount: 10, giftTotalPrice: 1 },
    { kind: 'gift', name: '上舰者', giftGuardLevel: 1, giftCount: 1, giftTotalPrice: 19998 },
    { kind: 'superchat', name: '留言者', message: '长留言也应该在纸张展开时保持清晰。'.repeat(3), price: 50 },
  ]) {
    const state = await frame.evaluate(async item => {
      feed.render([]);
      feed.append(item);
      await document.fonts.ready;
      await new Promise(requestAnimationFrame);
      const animations = root.getAnimations({ subtree: true });
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = animation.animationName ? 430 : animation.effect.getTiming().duration;
      }
      const opacity = Number(getComputedStyle(root.querySelector('.spooky-board')).opacity);
      const duration = root.firstElementChild.getAnimations().find(animation => animation.animationName === 'spookyEntry').effect.getTiming().duration;
      for (const animation of animations) if (animation.animationName) animation.currentTime = 1249;
      return { opacity, duration };
    }, item);
    assert.equal(state.duration, 1250, 'the complete decoration timeline is retained');
    assert.ok(Math.abs(state.opacity - (item.kind ? 0.416 : 0.66)) < 0.01, 'the original panel fade still interpolates');
    const before = await page.screenshot({ clip });
    await frame.evaluate(() => root.firstElementChild.getAnimations().find(animation => animation.animationName === 'spookyEntry').finish());
    await frame.waitForFunction(() => !root.querySelector('[data-live-entry]'));
    assert.ok((await page.screenshot({ clip })).equals(before), `${item.giftGuardLevel ? 'guard' : item.kind || 'chat'} must not sharpen only when its entrance ends`);
  }
});

test('spooky palette fills have independent alpha without fading text, decorations or replaying messages', { timeout: 15000 }, async t => {
  const page = await preview(t, 'up', 1, 'spooky');
  const markup = fs.readFileSync(path.join(__dirname, '../../public/pages/overlays/danmaku.html'), 'utf8');
  const result = await page.evaluate(async markup => {
    const source = new DOMParser().parseFromString(markup, 'text/html');
    const stage = document.querySelector('.danmaku-signal-stage');
    stage.prepend(source.querySelector('.spooky-frame'));
    Object.assign(stage.style, { width: '530px', height: '940px' });
    feed.render([{ name: '聊天者', message: '文字保持清晰' },
      { kind: 'gift', name: '送礼者', giftName: '小心心', giftCount: 2, giftTotalPrice: 10 },
      { kind: 'superchat', name: '留言者', message: 'SC 正文独立于事件底色', price: 50 }]);
    await new Promise(requestAnimationFrame);
    const rows = Array.from(root.children);
    const chat = root.querySelector('.spooky-copy').closest('.spooky-item');
    const gift = root.querySelector('.is-gift');
    const sc = root.querySelector('.spooky-sc');
    const { applyStyleOptions } = await import('/js/shared/danmaku-style-options.js');
    const options = { spookyTheme: 'moonlight', textColor: '#efefef', spookyFrameColor: '#123456',
      spookyMessageColor: '#234567', spookyEventColor: '#345678', spookyAccentColor: '#cc6600',
      spookyFrameOpacity: 0, spookyMessageOpacity: 40, spookyEventOpacity: 75 };
    applyStyleOptions(document, 'spooky', { spooky: options });
    const context = document.createElement('canvas').getContext('2d');
    function alpha(color) {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3];
    }
    function gradientAlphas(element) {
      return getComputedStyle(element).backgroundImage.match(/color\([^)]*\)/g).map(alpha);
    }
    const custom = {
      frame: gradientAlphas(stage.querySelector('.spooky-frame-board')),
      framePaper: alpha(getComputedStyle(stage.querySelector('.spooky-frame-paper')).backgroundColor),
      chat: gradientAlphas(chat.querySelector('.spooky-board')),
      backPaper: gradientAlphas(chat.querySelector('.spooky-back-paper')),
      frontPaper: alpha(getComputedStyle(chat.querySelector('.spooky-front-paper')).backgroundColor),
      gift: alpha(getComputedStyle(gift.querySelector('.spooky-board')).backgroundColor),
      sc: alpha(getComputedStyle(sc.querySelector('.spooky-board')).backgroundColor),
      text: [chat.querySelector('.spooky-copy'), sc.querySelector('.spooky-sc-copy')].map(node => getComputedStyle(node).color),
      opacity: [chat, chat.querySelector('.spooky-board'), chat.querySelector('.spooky-copy'), chat.querySelector('.spooky-sticker'), stage.querySelector('.spooky-frame-outline')].map(node => getComputedStyle(node).opacity),
      accent: getComputedStyle(chat.querySelector('.spooky-star')).backgroundColor,
    };
    applyStyleOptions(document, 'spooky', { spooky: { spookyTheme: 'autumn' } });
    return { custom, retained: rows.every((node, index) => root.children[index] === node),
      replayed: rows.some(node => node.hasAttribute('data-live-entry')),
      restoredInk: getComputedStyle(chat.querySelector('.spooky-copy')).color,
      restoredChat: gradientAlphas(chat.querySelector('.spooky-board')),
      restoredEvent: alpha(getComputedStyle(gift.querySelector('.spooky-board')).backgroundColor),
      restoredFrame: gradientAlphas(stage.querySelector('.spooky-frame-board')) };
  }, markup);
  assert.deepEqual(result.custom.frame, [0, 0]);
  assert.equal(result.custom.framePaper, 0);
  assert.deepEqual(result.custom.chat, [102, 102]);
  assert.deepEqual(result.custom.backPaper, [102, 102]);
  assert.equal(result.custom.frontPaper, 102);
  assert.equal(result.custom.gift, 191);
  assert.equal(result.custom.sc, 191);
  assert.deepEqual(result.custom.text, ['rgb(239, 239, 239)', 'rgb(239, 239, 239)']);
  assert.ok(result.custom.opacity.every(value => value === '1'));
  assert.notEqual(result.custom.accent, 'rgb(166, 187, 255)');
  assert.equal(result.retained, true);
  assert.equal(result.replayed, false);
  assert.equal(result.restoredInk, 'rgb(255, 241, 209)');
  assert.deepEqual(result.restoredChat, [255, 255]);
  assert.equal(result.restoredEvent, 255);
  assert.deepEqual(result.restoredFrame, [255, 255]);
});

test('spooky frame keeps stickers visible, uses its own ink, and fits a full-width long SC', { timeout: 15000 }, async t => {
  const page = await preview(t, 'up', 1, 'spooky');
  await page.setViewportSize({ width: 640, height: 700 });
  const markup = fs.readFileSync(path.join(__dirname, '../../public/pages/overlays/danmaku.html'), 'utf8');
  const result = await page.evaluate(async markup => {
    const source = new DOMParser().parseFromString(markup, 'text/html');
    const stage = document.querySelector('.danmaku-signal-stage');
    stage.prepend(source.querySelector('.spooky-frame'));
    Object.assign(stage.style, { width: '530px', height: '620px' });
    feed.render([{ name: '真实昵称', message: '晚安', roomGuardLevel: 3 }]);
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    const name = root.querySelector('.spooky-name');
    const sticker = root.querySelector('.spooky-sticker').getBoundingClientRect();
    const feedBounds = root.getBoundingClientRect();
    const outline = stage.querySelector('.spooky-frame-outline').getBoundingClientRect();
    const title = stage.querySelector('.spooky-frame-title').getBoundingClientRect();
    const frameLayout = { headerHeight: feedBounds.top - outline.top, bottomGap: outline.bottom - feedBounds.bottom,
      feedHeight: feedBounds.height, titleClear: title.top >= outline.top && title.bottom < feedBounds.top };
    const ink = getComputedStyle(name).color;
    const stickerInside = sticker.right <= root.getBoundingClientRect().right + .5;
    const clip = getComputedStyle(root.firstElementChild).clipPath;
    const { applyStyleOptions } = await import('/js/shared/danmaku-style-options.js');
    applyStyleOptions(document, 'spooky', { spooky: { fontFamily: '"Arial"' } });
    const customNameFont = getComputedStyle(name).fontFamily;
    const customCopyFont = getComputedStyle(root.querySelector('.spooky-copy')).fontFamily;
    feed.render([{ kind: 'gift', name: '送礼者', giftName: '小心心', giftCount: 10, giftTotalPrice: 50 }]);
    await new Promise(requestAnimationFrame);
    const giftFont = parseFloat(getComputedStyle(root.querySelector('.spooky-event-copy')).fontSize);
    const message = '把这首歌送给认真生活的大家，希望每个人都能有一个安静而温柔的夜晚。'.repeat(5);
    feed.render([{ kind: 'superchat', name: '完整留言者', message, price: 50 }]);
    await new Promise(requestAnimationFrame);
    const top = root.getBoundingClientRect().top;
    const sender = root.querySelector('.spooky-event-name').getBoundingClientRect();
    const copy = root.querySelector('.spooky-sc-copy');
    const copyClearOfSticker = copy.getBoundingClientRect().bottom <= root.querySelector('.spooky-sticker').getBoundingClientRect().top + .5;
    return { ink, clip, stickerInside, frameLayout, customNameFont, customCopyFont, giftFont, senderInside: sender.top >= top - .5,
      message: copy.textContent, expected: message, copyClearOfSticker, fullWidth: copy.parentElement.classList.contains('spooky-board'),
      overflow: copy.scrollWidth - copy.clientWidth, frames: stage.querySelectorAll('.spooky-frame').length };
  }, markup);
  assert.equal(result.ink, 'rgb(252, 230, 250)');
  assert.equal(result.clip, 'none');
  assert.equal(result.stickerInside, true);
  assert.deepEqual(result.frameLayout, { headerHeight: 60, bottomGap: 0, feedHeight: 494, titleClear: true });
  assert.match(result.customNameFont, /Arial/);
  assert.match(result.customCopyFont, /Arial/);
  assert.ok(result.giftFont <= 15, 'generic gift CSS must not enlarge this style’s event copy');
  assert.equal(result.senderInside, true);
  assert.equal(result.message, result.expected);
  assert.equal(result.fullWidth, true);
  assert.equal(result.copyClearOfSticker, true, 'the bat sticker must not cover the final SC line');
  assert.ok(result.overflow <= 1);
  assert.equal(result.frames, 1);
});

async function preview(t, direction, scale, style = 'moonlit') {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/danmaku.css">
    <body data-style="${style}" data-scroll-direction="${direction}">
      <div class="danmaku-signal-stage" style="width:640px;height:420px;transform:scale(${scale});transform-origin:top left">
        <div id="feed" class="draw-danmaku-feed"></div>
      </div>
    </body>` });
  t.after(() => fixture.close());
  const session = openBrowserSession();
  t.after(() => session.close());
  const page = await session.newPage({ viewport: { width: 640, height: 420 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async style => {
    const { createDanmakuFeed } = await import('/js/overlays/danmaku-feed.js');
    window.root = document.getElementById('feed');
    window.feed = createDanmakuFeed(root, { style, offscreenViewports: 0, autoScroll: false, maxItems: 8 });
    feed.render([
      { name: '云洲来信', message: '提督报到，这一段太好听了', guardLevel: 2 },
      { name: '路过听一首', message: '刚进来，这首歌叫什么名字呀？' },
      { name: '山间晚风', message: '戴上耳机听这一段真的好舒服。\n今天也辛苦啦，大家早点休息！' },
    ]);
    window.freezeMoves = time => Array.from(root.children).forEach(node => node.getAnimations().forEach(animation => {
      animation.pause();
      animation.currentTime = time;
    }));
  }, style);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await page.waitForFunction(() => document.getAnimations()
    .filter(animation => animation.effect.getTiming().iterations !== Infinity)
    .every(animation => animation.playState !== 'running'));
  return page;
}

for (const direction of ['up', 'down']) {
  for (const scale of [1, 0.63]) {
    test(`moonlit ${direction} at ${scale} preserves text, visible rows and interrupted spacing`, { timeout: 15000 }, async t => {
      const page = await preview(t, direction, scale);
      const textClip = await page.locator('#feed .draw-danmaku-body p').nth(1).boundingBox();
      const before = scale === 1 ? await page.screenshot({ clip: textClip }) : null;
      await page.evaluate(async () => {
        window.oldNodes = Array.from(root.children);
        window.oldTops = oldNodes.map(node => node.getBoundingClientRect().top);
        window.oldWeights = oldNodes.map(node => getComputedStyle(node.querySelector('p')).fontWeight);
        feed.append({ name: '新观众', message: '新弹幕加入测试' });
        feed.append({ name: '另一位', message: '同一帧追加消息' });
        await new Promise(requestAnimationFrame);
        freezeMoves(0);
      });
      // Fractional canvas scaling can round antialiasing; compare exact glyph pixels at native scale.
      if (before) assert.ok((await page.screenshot({ clip: textClip })).equals(before), 'starting movement must preserve the existing text pixels');
      const start = await page.evaluate(() => oldNodes.map((node, index) => ({
        weightChanged: getComputedStyle(node.querySelector('p')).fontWeight !== oldWeights[index],
        connected: node.isConnected,
        delta: node.getBoundingClientRect().top - oldTops[index],
      })));
      assert.ok(start.every(row => row.connected && Math.abs(row.delta) < 0.1 && !row.weightChanged));

      const interrupted = await page.evaluate(async () => {
        freezeMoves(200);
        const nodes = Array.from(root.children);
        const tops = nodes.map(node => node.getBoundingClientRect().top);
        feed.append({ name: '连续消息', message: '移动中接着追加' });
        await new Promise(requestAnimationFrame);
        freezeMoves(0);
        return {
          deltas: nodes.map((node, index) => node.getBoundingClientRect().top - tops[index]),
          boxes: Array.from(root.children).map(node => {
            const rect = node.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom };
          }).sort((left, right) => left.top - right.top),
        };
      });
      assert.ok(interrupted.deltas.every(delta => Math.abs(delta) < 0.1), 'retarget without snapping to the destination');
      for (let index = 1; index < interrupted.boxes.length; index += 1) {
        assert.ok(interrupted.boxes[index].top - interrupted.boxes[index - 1].bottom >= 14 * scale - 0.1,
          'incoming rows follow the moving tail without overlapping');
      }
      await page.evaluate(() => Array.from(root.children).forEach(node => node.getAnimations().forEach(animation => animation.finish())));
      await page.waitForFunction(() => !oldNodes[0].isConnected && Array.from(root.children).every(node => !node.getAnimations().length));
      assert.ok(await page.evaluate(() => oldNodes[2].isConnected), 'retain the partially visible boundary row');
      const afterPruning = await page.evaluate(async () => {
        const nodes = Array.from(root.children);
        const tops = nodes.map(node => node.getBoundingClientRect().top);
        feed.append({ name: '清理后追加', message: '继续保持原来的位置' });
        await new Promise(requestAnimationFrame);
        freezeMoves(0);
        return nodes.map((node, index) => node.getBoundingClientRect().top - tops[index]);
      });
      assert.ok(afterPruning.every(delta => Math.abs(delta) < 0.1), 'pruning must not invalidate the retained rows position');
      await page.evaluate(() => feed.destroy());
      assert.equal(await page.locator('#feed > *').count(), 0);
    });
  }
}

test('long SC fitting is not repeated at movement completion and still responds to resize and effects', { timeout: 15000 }, async t => {
  const page = await preview(t, 'up', 1, 'prismatic');
  await page.evaluate(async () => {
    document.querySelector('.danmaku-signal-stage').style.height = '240px';
    feed.render([{ id: 'long-sc', kind: 'superchat', name: '测试观众', price: 30,
      message: '这是一条用于隔离测量的完整长留言。'.repeat(6) }]);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    window.card = root.firstElementChild;
    window.fontWrites = 0;
    window.originalSetProperty = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
      if (this === card.style && name === 'font-size') fontWrites++;
      return originalSetProperty.call(this, name, value, priority);
    };
    feed.append({ id: 'short-chat', name: '新观众', message: '新增一条短弹幕' });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    freezeMoves(100);
  });
  const before = await page.evaluate(() => ({ writes: fontWrites, size: card.style.fontSize }));
  assert.ok(before.writes > 1, 'the long card is fitted when the content layout changes');
  await page.evaluate(async () => {
    Array.from(root.children).forEach(node => node.getAnimations().forEach(animation => animation.finish()));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  assert.deepEqual(await page.evaluate(() => ({ writes: fontWrites, size: card.style.fontSize })), before);
  await page.evaluate(() => { document.querySelector('.danmaku-signal-stage').style.height = '300px'; });
  await page.waitForFunction(writes => fontWrites > writes, before.writes);
  const resized = await page.evaluate(() => ({ writes: fontWrites, size: card.style.fontSize }));
  assert.ok(parseFloat(resized.size) > parseFloat(before.size));
  await page.evaluate(() => window.dispatchEvent(new Event('lira:effects-updated')));
  await page.waitForFunction(writes => fontWrites > writes, resized.writes);
  await page.evaluate(() => {
    CSSStyleDeclaration.prototype.setProperty = originalSetProperty;
    feed.destroy();
  });
});

test('moonlit bounds bursts and finishes active movement when reduced motion is enabled', { timeout: 15000 }, async t => {
  const page = await preview(t, 'up', 1);
  await page.evaluate(async () => {
    for (let index = 0; index < 12; index += 1) feed.append({ name: `观众${index}`, message: '连续弹幕' });
    await new Promise(requestAnimationFrame);
    freezeMoves(100);
  });
  assert.equal(await page.locator('#feed > *').count(), 8, 'enforce the item limit even while moving');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => root.children.length === 4 && Array.from(root.children).every(node => !node.getAnimations().length));
  await page.evaluate(() => feed.append({ name: '减少动态效果', message: '直接显示完整内容' }));
  await page.waitForFunction(() => root.lastElementChild.textContent.includes('直接显示完整内容') && root.children.length === 4);
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(async () => {
    feed.append({ name: '销毁测试', message: '移动中关闭' });
    await new Promise(requestAnimationFrame);
    feed.destroy();
    await new Promise(requestAnimationFrame);
  });
  assert.equal(await page.locator('#feed > *').count(), 0);
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
});

for (const style of styledMotion) {
  for (const direction of ['up', 'down']) {
    test(`${style} ${direction} owns its entrance while interrupted rows stay together`, { timeout: 15000 }, async t => {
      const scale = direction === 'up' ? 1 : 0.63;
      const page = await preview(t, direction, scale, style);
      const start = await page.evaluate(async style => {
        const old = Array.from(root.children);
        const tops = old.map(node => node.getBoundingClientRect().top);
        feed.append({ id: 'new-chat', name: '新观众', message: '晚上好，这段好听！' });
        feed.append({ id: 'new-sc', kind: 'superchat', name: '远方来信', price: 30,
          message: '今晚也很开心。愿每个认真生活的人，都能遇到温柔的回应。' });
        await new Promise(requestAnimationFrame);
        freezeMoves(0);
        const arrivals = Array.from(root.children).slice(-2);
        const rowMotions = Array.from(root.children).flatMap(node => node.getAnimations())
          .filter(animation => !animation.animationName);
        return {
          names: arrivals.map(node => node.getAnimations({ subtree: style === 'snowfox' }).filter(animation => animation.animationName).map(animation => animation.animationName)),
          oldEntrances: old.flatMap(node => node.getAnimations()).filter(animation => animation.animationName).length,
          deltas: old.map((node, i) => node.getBoundingClientRect().top - tops[i]),
          durations: rowMotions.map(animation => animation.effect.getTiming().duration),
          max: Number(getComputedStyle(root).getPropertyValue('--danmaku-move-max-ms')),
        };
      }, style);
      assert.ok(start.names.every(names => names.length >= 1 && names.every(name => name.startsWith(style))), 'live cards use their own entrance or existing decorative sequence');
      assert.equal(start.oldEntrances, 0, 'snapshot rows never replay a live entrance');
      // Variable-width cards use rounded offsetWidth; allow half a layout pixel, as in the original feed.
      assert.ok(start.deltas.every(delta => Math.abs(delta) < 0.5 * scale), `existing rows begin at their visible positions: ${start.deltas}`);
      assert.ok(start.durations.length > 0 && start.durations.every(duration => duration === start.durations[0] && duration <= start.max),
        'one style-owned duration keeps all moving rows in step');

      const interrupted = await page.evaluate(async () => {
        freezeMoves(120);
        const nodes = Array.from(root.children);
        const tops = nodes.map(node => node.getBoundingClientRect().top);
        const entrances = nodes.flatMap(node => node.getAnimations()).filter(animation => animation.animationName);
        feed.append({ id: 'new-gift', kind: 'gift', name: '星河', giftName: '小花花', giftCount: 3, giftTotalPrice: 15 });
        await new Promise(requestAnimationFrame);
        nodes.forEach(node => node.getAnimations().filter(animation => !animation.animationName).forEach(animation => {
          animation.pause();
          animation.currentTime = 0;
        }));
        const newest = root.lastElementChild;
        newest.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 0; });
        const boxes = Array.from(root.children).map(node => {
          const rect = node.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        }).sort((a, b) => a.top - b.top);
        return {
          deltas: nodes.map((node, i) => node.getBoundingClientRect().top - tops[i]),
          entranceTimes: entrances.map(animation => animation.currentTime),
          gaps: boxes.slice(1).map((box, i) => box.top - boxes[i].bottom),
        };
      });
      assert.ok(interrupted.deltas.every(delta => Math.abs(delta) < 0.5 * scale), `retargeting stays within layout rounding: ${interrupted.deltas}`);
      assert.ok(interrupted.entranceTimes.every(time => time === 120), 'retargeting does not restart or cancel an entrance');
      assert.ok(interrupted.gaps.every(gap => gap >= -0.2), 'different-height arrivals never cross other cards');

      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => Array.from(root.children).every(node => !node.getAnimations().length));
      assert.ok(await page.evaluate(() => Array.from(root.children).every(node => getComputedStyle(node).opacity === '1')));
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.evaluate(() => feed.render([{ id: 'snapshot', name: '恢复消息', message: '内容完整，直接可读。' }]));
      await page.waitForFunction(() => root.children.length === 1 && !root.firstElementChild.getAnimations().length);
      assert.equal(await page.evaluate(() => root.firstElementChild.hasAttribute('data-live-entry')), false);
      await page.evaluate(() => feed.append({ name: '正常完成', message: '读完之后，画面安静下来。' }));
      await page.waitForFunction(() => Array.from(root.children).every(node => !node.getAnimations().length && !node.hasAttribute('data-live-entry')));
      await page.evaluate(async () => { feed.append({ name: '结束', message: '动画中销毁' }); await new Promise(requestAnimationFrame); feed.destroy(); });
      assert.equal(await page.locator('#feed > *').count(), 0);
      assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    });
  }
}

test('flower-letter large stickers expand the paper and remain above its signature', { timeout: 15000 }, async t => {
  const page = await preview(t, 'up', 1, 'flower-letter');
  await page.setViewportSize({ width: 640, height: 940 });
  const result = await page.evaluate(async () => {
    document.querySelector('.danmaku-signal-stage').style.height = '940px';
    const { applyStyleOptions } = await import('/js/shared/danmaku-style-options.js');
    applyStyleOptions(document, 'flower-letter', {});
    const emote = { text: '[打call]', url: '/img/overlays/danmaku-previews/dacall.png', kind: 'sticker' };
    feed.render([
      { name: '普通观众', message: emote.text, emotes: [emote] },
      { name: '舰长观众', roomGuardLevel: 3, message: emote.text, emotes: [emote] },
      { name: '行内表情', message: `好听${emote.text}`, emotes: [{ ...emote, kind: 'inline' }] },
    ]);
    await document.fonts.ready;
    await Promise.all(Array.from(root.querySelectorAll('img'), image => image.decode()));
    await new Promise(requestAnimationFrame);
    return Array.from(root.children, card => {
      const copy = card.querySelector('.flower-copy').getBoundingClientRect();
      const emote = card.querySelector('.draw-danmaku-emote').getBoundingClientRect();
      const signature = card.querySelector('.flower-signature').getBoundingClientRect();
      return { large: card.classList.contains('is-emote-only'), height: emote.height,
        contained: emote.top >= copy.top - 0.1 && emote.bottom <= copy.bottom + 0.1,
        clearOfSignature: emote.bottom < signature.top };
    });
  });
  assert.equal(result.length, 3);
  for (const sticker of result.slice(0, 2)) {
    assert.equal(sticker.large, true);
    assert.equal(sticker.contained, true, 'the body reserves the complete sticker height');
    assert.equal(sticker.clearOfSignature, true, 'the sticker stays clear of the signature');
    assert.ok(sticker.height > result[2].height * 2.5, 'large stickers retain their size');
  }
  assert.equal(result[2].large, false);
});

test('flower-letter grows paper without stretching flowers and retains real content during mixed arrivals', { timeout: 15000 }, async t => {
  const page = await preview(t, 'up', 1, 'flower-letter');
  await page.setViewportSize({ width: 640, height: 940 });
  const result = await page.evaluate(async () => {
    document.querySelector('.danmaku-signal-stage').style.height = '940px';
    const { applyStyleOptions } = await import('/js/shared/danmaku-style-options.js');
    applyStyleOptions(document, 'flower-letter', {});
    const base = { name: '真实昵称', timestamp: '2026-10-26T13:28:00+08:00', roomGuardLevel: 3, roomMedal: { name: '来信', level: 25 } };
    feed.render([{ ...base, message: '短消息' }]);
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    const short = root.firstElementChild;
    const shortHeight = short.offsetHeight;
    const decorationHeight = short.querySelector('.flower-decoration').offsetHeight;
    const stageBounds = document.querySelector('.danmaku-signal-stage').getBoundingClientRect();
    const cardBounds = short.getBoundingClientRect();
    const lettering = document.createElement('span');
    lettering.style.cssText = 'position:absolute;width:1em;height:1em';
    short.querySelector('.flower-copy').append(lettering);
    const letteringWidth = lettering.getBoundingClientRect().width;
    lettering.remove();
    const message = '长消息会延展纸面，花叶保持比例。'.repeat(8);
    feed.render([{ ...base, message }]);
    await new Promise(requestAnimationFrame);
    const long = root.firstElementChild;
    const copy = long.querySelector('.flower-copy');
    const longResult = { shortHeight, longHeight: long.offsetHeight, decorationHeight,
      stageWidth: stageBounds.width, cardWidth: cardBounds.width, letteringWidth,
      centerOffset: (cardBounds.left + cardBounds.right - stageBounds.left - stageBounds.right) / 2,
      longDecorationHeight: long.querySelector('.flower-decoration').offsetHeight,
      text: copy.textContent, expected: message,
      clearOfSignature: copy.getBoundingClientRect().bottom < long.querySelector('.flower-signature').getBoundingClientRect().top,
      font: getComputedStyle(copy).fontFamily };
    feed.render([]);
    const rows = [
      { ...base, message: '混排[星]', emotes: [{ text: '[星]', url: '/img/overlays/danmaku-ranked/viewer.webp', kind: 'inline' }] },
      { kind: 'gift', name: '送礼者', giftName: '小花花', giftCount: 5, giftTotalPrice: 0.5 },
      { kind: 'gift', name: '免费礼物', giftName: '小心心', giftCount: 24, giftTotalPrice: 0 },
      { kind: 'gift', name: '上舰者', giftGuardLevel: 1, giftCount: 1, guardAction: 'open' },
      { kind: 'superchat', name: '留言者', price: 1000, message: '第一行\n第二行' },
    ];
    for (const row of rows) { feed.append(row); await new Promise(requestAnimationFrame); }
    return { ...longResult, variants: Array.from(root.children).map(n => n.className),
      emotes: root.querySelectorAll('.draw-danmaku-emote').length,
      amounts: Array.from(root.querySelectorAll('.flower-price')).map(n => n.textContent),
      duplicates: root.querySelectorAll('.flower-from').length,
      badArtwork: Array.from(root.querySelectorAll('img.flower-paper,img.flower-decoration')).filter(n => n.complete && !n.naturalWidth).length };
  });
  assert.ok(Math.abs(result.stageWidth - result.cardWidth - 40) < 0.1,
    'the visible paper leaves only 20px on either side of the default region');
  assert.ok(Math.abs(result.centerOffset) < 0.1, 'the visible paper is horizontally centered');
  assert.ok(Math.abs(result.letteringWidth - 24) < 0.2, 'widening the paper preserves the displayed font size');
  assert.ok(result.longHeight > result.shortHeight);
  assert.equal(result.decorationHeight, result.longDecorationHeight);
  assert.equal(result.text, result.expected);
  assert.equal(result.clearOfSignature, true);
  assert.match(result.font, /Lira Yozai/);
  assert.equal(result.emotes, 1);
  assert.deepEqual(result.amounts, ['CN¥0.5', 'CN¥1,000']);
  assert.equal(result.duplicates, 2);
  assert.equal(result.badArtwork, 0);
  assert.equal(result.variants.length, 5);
  assert.ok(result.variants.some(value => value.includes('flower-small-gift')));
  assert.ok(result.variants.some(value => value.includes('flower-join')));
});

test('twitter dense mixed arrivals preserve text, vectors and the social-card grid', { timeout: 15000 }, async t => {
  const page = await preview(t, 'up', 1, 'twitter');
  const longMessage = '长正文需要完整保留并且不能挤压相邻卡片。'.repeat(8) + '[合成表情]';
  const result = await page.evaluate(async longCopy => {
    feed.render([]);
    const emote = { text: '[合成表情]', url: '/img/overlays/danmaku-ranked/viewer.webp', width: 20, height: 20 };
    const samples = [
      { id: 'long', name: '长文观众', message: longCopy, emotes: [emote] },
      { id: 'repeat-one', name: '观众一', message: '重复文本' },
      { id: 'gift', kind: 'gift', name: '礼物观众', giftName: '小花花', giftCount: 2, giftTotalPrice: 2 },
      { id: 'guard', kind: 'gift', name: '提督观众', giftName: '提督', giftCount: 1, giftGuardLevel: 2 },
      { id: 'sc', kind: 'superchat', name: '留言观众', price: 100, message: '完整醒目留言，保留原文。' },
      { id: 'repeat-two', name: '观众二', message: '重复文本' },
    ];
    samples.forEach(item => feed.append(item));
    await new Promise(requestAnimationFrame);
    freezeMoves(120);
    const old = Array.from(root.children);
    const tops = old.map(node => node.getBoundingClientRect().top);
    const text = old.map(node => node.textContent);
    feed.append({ id: 'tail', name: '追加观众', message: '移动中继续追加。' });
    await new Promise(requestAnimationFrame);
    freezeMoves(0);
    const cards = Array.from(root.children).map(node => {
      const body = node.querySelector('.twitter-post-main');
      const avatar = node.querySelector('.twitter-avatar');
      const art = node.querySelector('.draw-danmaku-gift-art');
      return {
        kind: node.classList.contains('twitter-superchat') ? 'sc'
          : node.classList.contains('twitter-guard') ? 'guard'
            : node.classList.contains('twitter-gift') ? 'gift' : 'chat',
        display: getComputedStyle(node).display,
        zoom: Number.parseFloat(getComputedStyle(node).zoom) || 1,
        width: node.getBoundingClientRect().width,
        bodyOffset: body.getBoundingClientRect().left - node.getBoundingClientRect().left,
        avatar: [avatar.offsetWidth, avatar.offsetHeight],
        actions: node.querySelectorAll('.twitter-action-icon').length,
        overflow: node.scrollWidth - node.clientWidth,
        art: art ? [getComputedStyle(art).position, art.offsetWidth] : null,
      };
    });
    const content = root.firstElementChild.querySelector('.twitter-post-content');
    return {
      cards,
      rootWidth: root.clientWidth,
      longText: Array.from(content.childNodes).map(node => node.tagName === 'IMG' ? node.alt : node.textContent).join(''),
      emotes: content.querySelectorAll('.draw-danmaku-emote').length,
      repeated: Array.from(root.querySelectorAll('.twitter-post-content'))
        .filter(node => node.textContent === '重复文本').length,
      maxDelta: Math.max(...old.map((node, index) => Math.abs(node.getBoundingClientRect().top - tops[index]))),
      retained: old.every((node, index) => node.isConnected && node.textContent === text[index]),
    };
  }, longMessage);
  assert.equal(result.cards.length, 7);
  for (const card of result.cards) {
    assert.equal(card.display, 'grid');
    // Shared fitting may zoom an over-height card; its grid must scale with it.
    assert.ok(Math.abs(card.width - result.rootWidth * card.zoom) < 0.1, JSON.stringify({ card, rootWidth: result.rootWidth }));
    assert.ok(Math.abs(card.bodyOffset - 110 * card.zoom) < 0.1);
    assert.deepEqual(card.avatar, [80, 80]);
    assert.equal(card.actions, 4);
    assert.ok(card.overflow <= 1);
  }
  assert.deepEqual(result.cards.find(card => card.kind === 'gift').art, ['static', 64]);
  assert.deepEqual(result.cards.find(card => card.kind === 'guard').art, ['static', 84]);
  assert.equal(result.longText, longMessage);
  assert.equal(result.emotes, 1);
  assert.equal(result.repeated, 2);
  assert.ok(result.maxDelta < 0.1);
  assert.equal(result.retained, true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => Array.from(root.children).every(node => !node.getAnimations().length));
  await page.evaluate(() => feed.destroy());
});
test('RIPPLOID event roots retain their complete layer timelines', { timeout: 15000 }, async t => {
  const page = await preview(t, 'up', 1, 'ripploid');
  const events = [
    [{ id: 'gift', kind: 'gift', name: '送礼观众', giftName: '友谊的大船', giftCount: 1, giftTotalPrice: 100 }, 2000],
    [{ id: 'member', kind: 'gift', name: '新会员', giftGuardLevel: 2, giftName: '提督', giftTotalPrice: 1998 }, 1600],
    [{ id: 'sc', kind: 'superchat', name: '留言观众', price: 100, message: '完整留言' }, 1900],
  ];
  for (const [item, expectedDuration] of events) {
    const state = await page.evaluate(async item => {
      feed.render([]);
      feed.append(item);
      await new Promise(requestAnimationFrame);
      const card = root.firstElementChild;
      const marker = card.getAnimations().find(animation => animation.animationName === 'ripploidMessageIn');
      const layerCount = card.getAnimations({ subtree: true }).filter(animation => animation.animationName).length;
      const duration = marker?.effect.getTiming().duration;
      const liveBefore = card.hasAttribute('data-live-entry');
      marker?.finish();
      return { duration, layerCount, liveBefore };
    }, item);
    assert.equal(state.duration, expectedDuration, `${item.id} root marker matches its layer timeline`);
    assert.ok(state.layerCount > 1, `${item.id} owns independent layer animations`);
    assert.equal(state.liveBefore, true);
    await page.waitForFunction(() => root.children.length === 1 &&
      !root.firstElementChild.hasAttribute('data-live-entry') && !root.firstElementChild.getAnimations({ subtree: true }).length);
  }
  await page.evaluate(() => feed.destroy());
});

test('RIPPLOID cards share their right edge and decorations follow variable content height', { timeout: 15000 }, async t => {
  const page = await preview(t, 'up', 1, 'ripploid');
  const result = await page.evaluate(async () => {
    Object.assign(document.querySelector('.danmaku-signal-stage').style, { width: '520px', height: '640px' });
    root.style.setProperty('--danmaku-superchat-scale', String(496 / 460));
    const nextFrame = () => new Promise(requestAnimationFrame);
    const bounds = element => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { right: rect.right, top: rect.top, height: rect.height, center: (rect.top + rect.bottom) / 2 };
    };
    const samples = [
      { id: 'chat', name: '聊天观众', message: '晚上好', roomMedal: { name: 'BCBCB', level: 22 }, roomGuardLevel: 1 },
      { id: 'gift', kind: 'gift', name: '礼物观众', giftName: '友谊的大船', giftCount: 1, giftTotalPrice: 100 },
      { id: 'member', kind: 'gift', name: '舰长观众', giftGuardLevel: 3, giftTotalPrice: 138 },
      { id: 'sc', kind: 'superchat', name: '留言观众', price: 100, message: '完整留言' },
    ];
    const cards = [];
    for (const item of samples) {
      feed.render([item]);
      await nextFrame();
      const card = root.firstElementChild;
      cards.push({
        kind: card.classList.contains('ripploid-chat') ? 'chat'
          : card.classList.contains('ripploid-gift') ? 'gift'
            : card.classList.contains('ripploid-member') ? 'member' : 'superchat',
        width: card.getBoundingClientRect().width,
        root: bounds(card),
        stage: bounds(card.querySelector('.ripploid-event-stage')),
        ticket: bounds(card.querySelector('.ripploid-gift-ticket')),
        avatar: bounds(card.querySelector('.ripploid-member-avatar-clip')),
      });
    }

    const memberName = '一位名字特别长而且需要分成两行显示的舰长朋友';
    feed.render([{ kind: 'gift', name: memberName, giftGuardLevel: 3, giftTotalPrice: 138 }]);
    await nextFrame();
    const name = root.querySelector('.ripploid-member-name');
    const longName = {
      text: name.textContent,
      height: name.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(name).lineHeight),
    };

    const chatItem = message => ({ name: '聊天观众', message, roomMedal: { name: 'BCBCB', level: 22 }, roomGuardLevel: 1 });
    const measureChat = () => ({
      arrowCenter: bounds(root.querySelector('.ripploid-accent-arrow')).center,
      medalCenter: bounds(root.querySelector('.draw-danmaku-medal')).center,
      stemHeight: bounds(root.querySelector('.ripploid-accent-stem')).height,
    });
    feed.render([chatItem('一行正文')]);
    await nextFrame();
    const shortChat = measureChat();
    feed.render([chatItem('正文增加一行以后，左侧线条应该继续延伸，箭头仍然指向当前房间灯牌。')]);
    await nextFrame();
    return { cards, feedWidth: root.getBoundingClientRect().width, memberName, longName, shortChat, longChat: measureChat() };
  });

  assert.equal(result.feedWidth, 496);
  assert.ok(result.cards.every(card => Math.abs(card.width - result.feedWidth) < 0.1));
  for (const card of result.cards.filter(card => card.kind !== 'chat')) {
    assert.ok(Math.abs(card.stage.right - card.root.right) < 0.1, `${card.kind} stage reaches the shared right edge`);
    assert.ok(Math.abs(card.stage.height - card.root.height) < 0.1, `${card.kind} stage fills the card height`);
  }
  const member = result.cards.find(card => card.kind === 'member');
  assert.ok(Math.abs(member.avatar.right - member.root.right) < 0.1);
  const gift = result.cards.find(card => card.kind === 'gift');
  assert.ok(Math.abs(gift.ticket.right - gift.root.right) < 0.1);
  assert.ok(Math.abs(gift.ticket.top - gift.root.top) < 0.1, `ticket stays beside the gift main area: ${JSON.stringify(gift)}`);
  assert.equal(result.longName.text, result.memberName);
  assert.ok(result.longName.height > result.longName.lineHeight * 1.5);
  assert.ok(result.longName.height <= result.longName.lineHeight * 2.1);
  for (const chat of [result.shortChat, result.longChat]) {
    assert.ok(Math.abs(chat.arrowCenter - chat.medalCenter) < 1, 'arrow points at the medal row');
  }
  assert.ok(result.longChat.stemHeight > result.shortChat.stemHeight + 10);
  await page.evaluate(() => feed.destroy());
});

test('RIPPLOID entrance keeps alpha timing and painted text stable when its timeline ends', { timeout: 15000 }, async t => {
  const page = await preview(t, 'up', 0.925, 'ripploid');
  const state = await page.evaluate(async () => {
    feed.render([]);
    feed.append({ name: '清晰文字', message: '好耶！线条保持自然。' });
    await new Promise(requestAnimationFrame);
    const card = root.firstElementChild;
    const animations = card.getAnimations({ subtree: true });
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = animation.animationName ? 300.3 : 600;
    }
    const opacity = Number(getComputedStyle(card.querySelector('.ripploid-copy-wrap > p')).opacity);
    for (const animation of animations) if (animation.animationName) animation.currentTime = 699;
    return { opacity };
  });
  assert.ok(Math.abs(state.opacity - 0.5) < 0.01, 'the original body fade still interpolates halfway');
  const card = page.locator('.ripploid-chat');
  const before = await card.screenshot();
  await card.evaluate(node => node.getAnimations().find(animation => animation.animationName === 'ripploidMessageIn').finish());
  await page.waitForFunction(() => !root.querySelector('[data-live-entry]'));
  const after = await card.screenshot();
  assert.ok(after.equals(before), 'finishing the entrance must not change text or hairline rasterization');
  for (const [item, duration] of [
    [{ kind: 'gift', name: '礼物观众', giftName: '友谊的大船', giftCount: 2, giftTotalPrice: 100 }, 2000],
    [{ kind: 'gift', name: '舰长观众', giftGuardLevel: 3, giftTotalPrice: 138 }, 1600],
    [{ kind: 'superchat', name: '留言观众', message: '完整留言也保持清晰。', price: 100 }, 1900],
  ]) {
    await page.evaluate(async ({ item, duration }) => {
      feed.render([]);
      feed.append(item);
      await new Promise(requestAnimationFrame);
      for (const animation of root.getAnimations({ subtree: true })) {
        animation.pause();
        animation.currentTime = animation.animationName ? duration - 1 : 600;
      }
    }, { item, duration });
    const eventCard = page.locator('.ripploid-event-root');
    const lastFrame = await eventCard.screenshot();
    await eventCard.evaluate(node => node.getAnimations().find(animation => animation.animationName === 'ripploidMessageIn').finish());
    await page.waitForFunction(() => !root.querySelector('[data-live-entry]'));
    assert.ok((await eventCard.screenshot()).equals(lastFrame), `${item.giftGuardLevel ? 'member' : item.kind} finishes without raster changes`);
  }
  await page.evaluate(() => feed.destroy());
});
