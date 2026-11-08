'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { DANMAKU_STYLE_OPTIONS } = require('../../src/shared/danmaku-style-options');

const openBrowserSession = useSharedBrowser();
const styledMotion = Object.keys(DANMAKU_STYLE_OPTIONS)
  .filter(style => DANMAKU_STYLE_OPTIONS[style].scrollDirection && style !== 'moonlit');

async function preview(t, direction, scale, style = 'moonlit', flowAxis = 'vertical') {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/danmaku.css">
    <body data-style="${style}" data-scroll-direction="${direction}" data-stargazer-layout="${flowAxis}">
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
  await page.evaluate(async ({ style, flowAxis }) => {
    const { createDanmakuFeed } = await import('/js/overlays/danmaku-feed.js');
    window.root = document.getElementById('feed');
    window.feed = createDanmakuFeed(root, { style, flowAxis, fitWidth: !['celestial-horizontal', 'horizontal-charm'].includes(style), offscreenViewports: 0, autoScroll: false, maxItems: 8 });
    feed.render([
      { name: '云洲来信', message: '提督报到，这一段太好听了', guardLevel: 2 },
      { name: '路过听一首', message: '刚进来，这首歌叫什么名字呀？' },
      { name: '山间晚风', message: '戴上耳机听这一段真的好舒服。\n今天也辛苦啦，大家早点休息！' },
    ]);
    window.freezeMoves = time => Array.from(root.children).forEach(node => node.getAnimations().forEach(animation => {
      animation.pause();
      animation.currentTime = time;
    }));
  }, { style, flowAxis });
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

test('astral instant entry finishes so enabling layers only animates new messages', async t => {
  const page = await preview(t, 'up', 1, 'astral');
  await page.evaluate(async () => {
    const { applyStyleOptions } = await import('/js/overlays/danmaku-style-application.js');
    window.applyAstral = entrance => applyStyleOptions(document, 'astral', {
      astral: { astralEntrance: entrance, ambientMotion: 'off' },
    });
    applyAstral('none');
    feed.render([]);
    feed.append({ name: '星河', message: '直接显示的旧消息。' });
    window.original = root.lastElementChild;
  });
  await page.waitForFunction(() => !original.hasAttribute('data-live-entry'));
  const retained = await page.evaluate(async () => {
    applyAstral('layered');
    await new Promise(requestAnimationFrame);
    return { same: root.firstElementChild === original,
      opacity: getComputedStyle(original.querySelector('.astral-copy')).opacity,
      animations: original.querySelector('.astral-copy').getAnimations().length };
  });
  assert.equal(retained.same, true);
  assert.equal(retained.opacity, '1', 'changing entry mode keeps the old message readable');
  assert.equal(retained.animations, 0, 'the old message does not replay');
  await page.evaluate(() => feed.append({ name: '新来信', message: '只对新消息播放入场。' }));
  assert.equal(await page.locator('#feed > :last-child').getAttribute('data-live-entry'), 'true');
});

test('glass bubble long chat finishes revealing before the shortest stay begins fading', { timeout: 15000 }, async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/danmaku.css">
    <body data-style="glass-bubble"><div class="danmaku-signal-stage" style="width:1920px;height:1080px">
      <div id="feed" class="draw-danmaku-feed"></div>
    </div></body>` });
  t.after(() => fixture.close());
  const session = openBrowserSession();
  t.after(() => session.close());
  const page = await session.newPage({ viewport: { width: 1920, height: 1080 } });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const hiddenAtFade = await page.evaluate(async () => {
    const { createDanmakuFeed } = await import('/js/overlays/danmaku-feed.js');
    const { applyStyleOptions } = await import('/js/overlays/danmaku-style-application.js');
    applyStyleOptions(document, 'glass-bubble', { 'glass-bubble': { glassBubbleTypingSpeed: 60 } });
    const feed = createDanmakuFeed(document.getElementById('feed'), {
      style: 'glass-bubble', layout: 'fullscreen-random', autoScroll: false,
      itemLifetimeMs: 2000, exitDurationMs: 1000,
    });
    feed.render([{ name: '观众', message: '字体就绪' }]);
    await document.fonts.ready;
    feed.render([]);
    feed.append({ name: '观众', message: '希望这条长弹幕可以在开始退场之前完整显示。'.repeat(4), timestamp: Date.now() });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const glyphs = [...document.querySelectorAll('.glass-bubble-glyph')];
    glyphs.flatMap(node => node.getAnimations()).forEach(animation => {
      animation.pause();
      animation.currentTime = 1000;
    });
    const hidden = glyphs.filter(node => getComputedStyle(node).opacity !== '1').length;
    feed.destroy();
    return hidden;
  });
  assert.equal(hiddenAtFade, 0, 'the full message is readable before the earliest allowed fade');
});

test('wireframe keeps the chosen background transparency throughout live entrances', { timeout: 15000 }, async t => {
  const page = await preview(t, 'up', 1, 'wireframe');
  for (const kind of ['danmaku', 'superchat']) {
    for (const backgroundOpacity of [0, 35]) {
      const clip = await page.evaluate(async ({ kind, backgroundOpacity }) => {
        const { applyStyleOptions } = await import('/js/overlays/danmaku-style-application.js');
        applyStyleOptions(document, 'wireframe', { wireframe: { backgroundOpacity } });
        feed.render([]);
        feed.append({ id: kind, kind, name: '观众', message: '背景跟随已选透明度', price: 30 });
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        document.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 400; });
        const surface = root.lastElementChild.querySelector('.wireframe-surface').getBoundingClientRect();
        return { x: Math.floor(surface.left + surface.width / 2), y: Math.floor(surface.bottom - 3), width: 1, height: 1 };
      }, { kind, backgroundOpacity });
      const pixel = await page.screenshot({ clip, omitBackground: true });
      const alpha = await page.evaluate(async source => {
        const image = new Image();
        image.src = `data:image/png;base64,${source}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, 1, 1).data[3];
      }, pixel.toString('base64'));
      assert.ok(alpha <= Math.ceil(255 * backgroundOpacity / 100), `${kind} must not flash a more opaque background`);
      if (backgroundOpacity > 0) assert.ok(alpha > 0, `${kind} retains the configured translucent surface`);
    }
  }
});

for (const [style, direction, scale] of [['stargazer', 'up', 1], ['stargazer', 'down', 0.63], ['celestial-horizontal', 'up', 1], ['celestial-horizontal', 'up', 0.63], ['horizontal-charm', 'up', 1], ['horizontal-charm', 'up', 0.63]]) {
  test(`${style} horizontal ${direction} at ${scale} preserves interrupted positions and releases exited messages`, { timeout: 15000 }, async t => {
    const page = await preview(t, direction, scale, style, 'horizontal');
    const result = await page.evaluate(async () => {
      let removed = 0;
      const changes = [];
      const gaps = [];
      for (let index = 0; index < 16; index += 1) {
        freezeMoves(150);
        const area = root.getBoundingClientRect();
        const old = Array.from(root.children).map(node => ({ node, rect: node.getBoundingClientRect() }));
        feed.append({ id: `horizontal-${index}`, name: '连续观众', message: '横向消息保留完整内容' });
        await new Promise(requestAnimationFrame);
        freezeMoves(0);
        removed += old.filter(({ node }) => !node.isConnected).length;
        changes.push(...old.filter(({ rect }) => rect.right > area.left && rect.left < area.right)
          .map(({ node, rect }) => ({ connected: node.isConnected, delta: node.getBoundingClientRect().left - rect.left })));
        const boxes = Array.from(root.children).map(node => node.getBoundingClientRect()).sort((a, b) => a.left - b.left);
        gaps.push(...boxes.slice(1).map((box, i) => box.left - boxes[i].right));
      }
      feed.destroy();
      return { removed, changes, gaps, animations: document.getAnimations().length };
    });
    assert.ok(result.removed > 0);
    assert.ok(result.changes.every(row => row.connected && Math.abs(row.delta) < 0.5 * scale), 'visible cards continue without snapping');
    assert.ok(result.gaps.every(gap => gap >= -0.2), 'horizontal cards do not cross during dense arrivals');
    assert.equal(result.animations, 0, 'destroy releases entry, movement and ambient layers');
  });
}

test('top-aligned messages keep new content visible when the feed fills', { timeout: 15000 }, async t => {
  const page = await preview(t, 'up', 1, 'stargazer');
  await page.evaluate(async () => {
    document.body.dataset.stargazerAlign = 'top';
    feed.render([{ name: '第一位', message: '第一条消息' }]);
    await new Promise(requestAnimationFrame);
    window.firstCard = root.firstElementChild;
    window.firstTop = firstCard.getBoundingClientRect().top;
    for (let index = 0; index < 4; index += 1) feed.append({ name: '新观众', message: '较长的弹幕会换行显示完整内容。'.repeat(3) });
    await new Promise(requestAnimationFrame);
    freezeMoves(0);
  });
  assert.ok(await page.evaluate(() => Math.abs(firstCard.getBoundingClientRect().top - firstTop) < .5), 'overflow starts from the visible position');
  await page.evaluate(() => Array.from(root.children).forEach(node => node.getAnimations().forEach(animation => animation.finish())));
  const latest = await page.evaluate(() => ({ area: root.getBoundingClientRect().toJSON(), last: root.lastElementChild.getBoundingClientRect().toJSON() }));
  assert.ok(latest.last.bottom <= latest.area.bottom, 'newest message finishes inside the viewport');
  assert.ok(latest.last.top >= latest.area.top, 'a complete message remains readable');
  await page.evaluate(() => feed.destroy());
});

test('timed fixed messages finish fading during arrivals and reflow after expiration', { timeout: 15000 }, async t => {
  const page = await preview(t, 'up', 1, 'stargazer');
  const result = await page.evaluate(async () => {
    feed.destroy();
    const { createDanmakuFeed } = await import('/js/overlays/danmaku-feed.js');
    let clock = 10000;
    let sequence = 0;
    const timers = new Map();
    feed = createDanmakuFeed(root, { style: 'stargazer', offscreenViewports: 0, autoScroll: false,
      expireFixedItems: true, itemLifetimeMs: 1000, now: () => clock,
      scheduleTimeout(fn) { timers.set(++sequence, fn); return sequence; }, cancelTimeout(id) { timers.delete(id); } });
    feed.render([{ id: 'expiring', timestamp: clock, name: '观众', message: '保留到截止时间' }]);
    await new Promise(requestAnimationFrame);
    const old = root.firstElementChild;
    clock = 10600;
    const fade = timers.values().next().value;
    timers.delete(timers.keys().next().value);
    fade();
    const fading = old.getAnimations().find(animation => !animation.animationName);
    fading.currentTime = 200;
    const opacity = Number(getComputedStyle(old).opacity);
    feed.append({ id: 'incoming', timestamp: clock, name: '新观众', message: '移动时继续淡出' });
    await new Promise(requestAnimationFrame);
    const keptFade = fading?.playState === 'running';
    clock = 11000;
    const expire = timers.values().next().value;
    timers.delete(timers.keys().next().value);
    expire();
    await new Promise(requestAnimationFrame);
    const remaining = Array.from(root.children).map(node => node.textContent);
    feed.destroy();
    return { opacity, keptFade, expired: !old.isConnected, remaining, timers: timers.size };
  });
  assert.ok(result.opacity > 0 && result.opacity < 1, 'expiration visibly fades the message');
  assert.equal(result.keptFade, true);
  assert.equal(result.expired, true);
  assert.equal(result.remaining.length, 1);
  assert.ok(result.remaining[0].includes('移动时继续淡出'));
  assert.equal(result.timers, 0);
});

for (const style of ['starlight', 'notebook', 'christmas', 'stargazer', 'dark-moon', 'animated-gradient']) {
  test(`${style} can stop ambient loops while new messages keep their entrance and movement`, { timeout: 15000 }, async t => {
    const page = await preview(t, 'down', 1, style);
    const stopped = await page.evaluate(async style => {
      const { applyStyleOptions } = await import('/js/overlays/danmaku-style-application.js');
      const loops = () => document.getAnimations().filter(animation => animation.effect.getTiming().iterations === Infinity);
      const before = loops().length;
      const nodes = Array.from(root.children);
      applyStyleOptions(document, style, { [style]: { ambientMotion: 'off' } });
      return { before, after: loops().length, keptNodes: nodes.every(node => node.isConnected) };
    }, style);
    assert.ok(stopped.before > 0, 'the default style has ambient animation');
    assert.equal(stopped.after, 0, 'all ambient layers stop');
    assert.equal(stopped.keptNodes, true, 'changing ambient motion preserves messages');
    await page.evaluate(async () => {
      feed.append({ name: '新消息', roomGuardLevel: 3, message: '纸张和装饰静止，入场与滚动继续。' });
      await new Promise(requestAnimationFrame);
    });
    await page.waitForFunction(() => root.lastElementChild.hasAttribute('data-live-entry'));
    const entering = await page.evaluate(() => {
      const animations = document.getAnimations();
      return {
        entrance: root.lastElementChild.getAnimations().some(animation => Boolean(animation.animationName)),
        movement: animations.some(animation => !animation.animationName),
        loops: animations.filter(animation => animation.effect.getTiming().iterations === Infinity).length,
      };
    });
    assert.equal(entering.entrance, true);
    assert.equal(entering.movement, true);
    assert.equal(entering.loops, 0);
    await page.waitForFunction(() => document.getAnimations().length === 0);
    assert.equal(await page.evaluate(() => root.lastElementChild.textContent.includes('纸张和装饰静止，入场与滚动继续。')), true);
    await page.evaluate(async style => {
      const { applyStyleOptions } = await import('/js/overlays/danmaku-style-application.js');
      applyStyleOptions(document, style, {});
    }, style);
    assert.ok(await page.evaluate(() => document.getAnimations().some(animation => animation.effect.getTiming().iterations === Infinity)),
      'restoring defaults resumes ambient animation');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.getAnimations().length === 0);
    await page.evaluate(() => feed.destroy());
  });
}

for (const [direction, scale] of [['up', 1], ['down', 0.63]]) {
  test(`moonlit ${direction} at ${scale} preserves visible rows and interrupted spacing`, { timeout: 15000 }, async t => {
    const page = await preview(t, direction, scale);
    await page.evaluate(async () => {
      window.oldNodes = Array.from(root.children);
      window.oldTops = oldNodes.map(node => node.getBoundingClientRect().top);
      feed.append({ name: '新观众', message: '新弹幕加入测试' });
      feed.append({ name: '另一位', message: '同一帧追加消息' });
      await new Promise(requestAnimationFrame);
      freezeMoves(0);
    });
    const start = await page.evaluate(() => oldNodes.map((node, index) => ({
      connected: node.isConnected,
      delta: node.getBoundingClientRect().top - oldTops[index],
    })));
    assert.ok(start.every(row => row.connected && Math.abs(row.delta) < 0.1));

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

for (const [direction, scale] of [['up', 1], ['down', 0.63]]) {
  test(`continuous ${direction} arrivals release exited rows without disturbing visible messages`, { timeout: 15000 }, async t => {
    const page = await preview(t, direction, scale, 'christmas-letter');
    const result = await page.evaluate(async direction => {
      feed.destroy();
      const { createDanmakuFeed } = await import('/js/overlays/danmaku-feed.js');
      feed = createDanmakuFeed(root, { style: 'christmas-letter', offscreenViewports: 0, autoScroll: false, maxItems: 50 });
      let removed = 0, retainedExited = 0;
      const changes = [];
      for (let index = 0; index < 30; index += 1) {
        freezeMoves(150);
        const area = root.getBoundingClientRect();
        const previous = Array.from(root.children).map(node => ({ node, rect: node.getBoundingClientRect() }));
        const visible = previous.filter(({ rect }) => rect.bottom > area.top && rect.top < area.bottom);
        // Leave a whole card's clearance so decorative overflow cannot count as exited.
        const gone = previous.filter(({ rect }) => direction === 'up'
          ? rect.bottom + rect.height < area.top : rect.top - rect.height > area.bottom);
        feed.append({ id: `dense-${index}`, name: '连续观众', message: '密集消息保持顺畅' });
        await new Promise(requestAnimationFrame);
        freezeMoves(0);
        removed += previous.filter(({ node }) => !node.isConnected).length;
        retainedExited += gone.filter(({ node }) => node.isConnected).length;
        changes.push(...visible.map(({ node, rect }) => ({ connected: node.isConnected,
          delta: node.getBoundingClientRect().top - rect.top })));
      }
      feed.destroy();
      return { removed, retainedExited, changes };
    }, direction);
    assert.ok(result.removed > 0, 'the continuous stream releases old rows before reaching the item limit');
    assert.equal(result.retainedExited, 0, 'release fully exited rows while newer rows are still moving');
    assert.ok(result.changes.every(row => row.connected && Math.abs(row.delta) < 0.5 * scale),
      'retain visible rows at their current positions when pruning and retargeting');
  });
}

// Direction and canvas scale are shared feed branches covered by moonlit above;
// one representative combination checks each style's own motion CSS.
for (const style of styledMotion) {
  test(`${style} keeps interrupted rows together without replaying entrances`, { timeout: 15000 }, async t => {
    const scale = 0.63;
    const page = await preview(t, 'down', scale, style);
    const start = await page.evaluate(async () => {
      const old = Array.from(root.children);
      const tops = old.map(node => node.getBoundingClientRect().top);
      feed.append({ id: 'new-chat', name: '新观众', message: '晚上好，这段好听！' });
      feed.append({ id: 'new-sc', kind: 'superchat', name: '远方来信', price: 30,
        message: '今晚也很开心。愿每个认真生活的人，都能遇到温柔的回应。' });
      await new Promise(requestAnimationFrame);
      freezeMoves(0);
      const rowMotions = Array.from(root.children).flatMap(node => node.getAnimations())
        .filter(animation => !animation.animationName);
      return {
        oldEntrances: old.flatMap(node => node.getAnimations()).filter(animation => animation.animationName).length,
        deltas: old.map((node, i) => node.getBoundingClientRect().top - tops[i]),
        durations: rowMotions.map(animation => animation.effect.getTiming().duration),
      };
    });
    assert.equal(start.oldEntrances, 0, 'snapshot rows never replay a live entrance');
    // Variable-width cards use rounded offsetWidth; allow half a layout pixel, as in the original feed.
    assert.ok(start.deltas.every(delta => Math.abs(delta) < 0.5 * scale), `existing rows begin at their visible positions: ${start.deltas}`);
    assert.ok(start.durations.length > 0 && start.durations.every(duration => duration === start.durations[0]),
      'one duration keeps all moving rows in step');

    const interrupted = await page.evaluate(async () => {
      freezeMoves(120);
      const nodes = Array.from(root.children);
      const before = nodes.map(node => node.getBoundingClientRect());
      const viewport = root.getBoundingClientRect();
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
        deltas: nodes.flatMap((node, i) => node.isConnected ? [node.getBoundingClientRect().top - before[i].top] : []),
        removedVisible: nodes.some((node, i) => !node.isConnected
          && before[i].bottom > viewport.top && before[i].top < viewport.bottom),
        entranceTimes: entrances.map(animation => animation.currentTime),
        gaps: boxes.slice(1).map((box, i) => box.top - boxes[i].bottom),
      };
    });
    assert.equal(interrupted.removedVisible, false, 'retargeting never removes a visible message');
    assert.ok(interrupted.deltas.every(delta => Math.abs(delta) < 0.5 * scale), `retargeting stays within layout rounding: ${interrupted.deltas}`);
    assert.ok(interrupted.entranceTimes.every(time => time === 120), 'retargeting does not restart or cancel an entrance');
    assert.ok(interrupted.gaps.every(gap => gap >= -0.2), `different-height arrivals never cross other cards: ${interrupted.gaps}`);

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
