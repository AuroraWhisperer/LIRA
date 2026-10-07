'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

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
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
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
      await page.evaluate(() => feed.destroy());
      assert.equal(await page.locator('#feed > *').count(), 0);
    });
  }
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
