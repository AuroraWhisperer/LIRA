'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

const openBrowserSession = useSharedBrowser();

test('Glowy retains shared perspective through layered arrival and both ordered flow axes', { timeout: 15000 }, async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/danmaku.css">
    <div class="danmaku-signal-stage" style="width:1320px;height:500px">
      <div id="danmakuFeed" class="draw-danmaku-feed"></div>
    </div>` });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 600 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const { createDanmakuFeed } = await import('/js/overlays/danmaku-feed.js');
    const { applyStyleOptions } = await import('/js/overlays/danmaku-style-application.js');
    const { createComponentStyleEffects } = await import('/js/overlays/component-style-effects.js');
    const effects = createComponentStyleEffects(document);
    const root = document.getElementById('danmakuFeed');
    document.body.dataset.style = 'glowy';
    const measurements = [];
    for (const axis of ['vertical', 'horizontal']) {
      root.parentElement.style.width = axis === 'horizontal' ? '1320px' : '520px';
      applyStyleOptions(document, 'glowy', { glowy: { glowyLayout: axis } });
      const feed = createDanmakuFeed(root, { style: 'glowy', flowAxis: axis, autoScroll: false, expireItems: false });
      feed.render([
        ...[0, 1].map(index => ({ id: `old-${index}`, name: '舰队', message: '原有消息', roomGuardLevel: 3 })),
        { id: 'member', kind: 'gift', name: '舰队', giftGuardLevel: 3, guardAction: 'renew', giftCount: 1, giftTotalPrice: 138 },
      ]);
      const old = root.lastElementChild;
      effects.update('danmaku', { style: 'glowy', styleParameters: { glowy: {
        transform: { rotateY: 18, perspective: 1400 },
        textOutline: { width: 1, color: '#000000', opacity: 100 },
      } } });
      feed.append({ id: 'sc', kind: 'superchat', name: '留言观众', message: '完整留言', price: 30 });
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const newest = root.lastElementChild;
      const finite = document.getAnimations().filter(a => a.effect.getTiming().iterations !== Infinity);
      finite.forEach(a => { a.pause(); a.currentTime = 400; });
      const loops = () => document.getAnimations().filter(a => a.effect.getTiming().iterations === Infinity).length;
      const ambientBefore = loops();
      applyStyleOptions(document, 'glowy', { glowy: { glowyLayout: axis, ambientMotion: 'off' } });
      measurements.push({ axis, is3d: !new DOMMatrix(getComputedStyle(newest).transform).is2D,
        ambientBefore, ambientOff: loops(),
        perspective: newest.style.getPropertyValue('--component-transform').includes('1400px'),
        oldPreserved: old.isConnected && !old.hasAttribute('data-live-entry'),
        content: newest.querySelector('.sc-copy').textContent,
        amount: newest.querySelector('.glowy-amount').textContent,
        stroke: getComputedStyle(newest.querySelector('.glowy-copy')).webkitTextStrokeWidth,
        axisStyle: getComputedStyle(root).flexDirection });
      feed.remove(['sc']);
      measurements.at(-1).removed = !root.querySelector('.is-superchat');
      const position = axis === 'horizontal' ? 'left' : 'top';
      const end = axis === 'horizontal' ? 'right' : 'bottom';
      let minimumGap = Infinity;
      for (let frame = 0; frame < 50; frame += 1) {
        if (frame < 14) feed.append({ id: `burst-${frame}`, name: '连续来信', message: '侧倾消息平稳接续。', roomGuardLevel: 3 });
        await new Promise(requestAnimationFrame);
        const viewport = root.getBoundingClientRect();
        const boxes = [...root.children].map(node => node.getBoundingClientRect())
          .filter(rect => rect[end] > viewport[position] && rect[position] < viewport[end])
          .sort((a, b) => a[position] - b[position]);
        for (let i = 1; i < boxes.length; i += 1) minimumGap = Math.min(minimumGap, boxes[i][position] - boxes[i - 1][end]);
      }
      measurements.at(-1).minimumGap = minimumGap;
      feed.destroy();
    }
    effects.dispose();
    return measurements;
  });
  for (const sample of result) {
    assert.equal(sample.is3d, true, sample.axis);
    assert.equal(sample.perspective, true);
    assert.equal(sample.oldPreserved, true);
    assert.equal(sample.content, '完整留言');
    assert.equal(sample.amount, '¥30');
    assert.equal(sample.stroke, '1px');
    assert.match(sample.axisStyle, sample.axis === 'horizontal' ? /^row/ : /^column/);
    assert.equal(sample.removed, true);
    assert.ok(sample.ambientBefore > 0);
    assert.equal(sample.ambientOff, 0);
    assert.ok(sample.minimumGap >= -.2, `${sample.axis}: perspective cards stay apart throughout a burst (${JSON.stringify(result)})`);
  }
  assert.deepEqual(errors, []);
});
