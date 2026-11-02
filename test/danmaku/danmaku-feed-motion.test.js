'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { DANMAKU_STYLE_OPTIONS } = require('../../src/shared/danmaku-style-options');

const openBrowserSession = useSharedBrowser();
const styledMotion = Object.keys(DANMAKU_STYLE_OPTIONS)
  .filter(style => DANMAKU_STYLE_OPTIONS[style].scrollDirection && style !== 'moonlit');

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

for (const style of ['starlight', 'notebook']) {
  test(`${style} can stop ambient loops while new messages keep their entrance and movement`, { timeout: 15000 }, async t => {
    const page = await preview(t, 'down', 1, style);
    const stopped = await page.evaluate(async style => {
      const { applyStyleOptions } = await import('/js/shared/danmaku-style-options.js');
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
      const { applyStyleOptions } = await import('/js/shared/danmaku-style-options.js');
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
