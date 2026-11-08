const test = require('node:test');
const assert = require('node:assert/strict');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const contract = require('../../public/js/shared/component-style-parameters.js');

const openBrowserSession = useSharedBrowser();

test('fixed danmaku keeps perspective separate from filter reset and restores it across style switches', async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: '<!doctype html><button id="reset">恢复默认</button><div id="parameters"></div>' });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage();
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async () => {
    const { mountDanmakuParameters } = await import('/js/shared/danmaku-parameter-controls.js');
    const { styleParameterDefaults } = await import('/js/shared/component-style-parameters.js');
    window.state = { draft: { style: 'glowy', styleOptions: { glowy: { glowyLayout: 'horizontal' } }, styleParameters: {
      glowy: { transform: { ...styleParameterDefaults('transform'), rotateY: 25, rotateZ: 7 },
        whiteBalance: { ...styleParameterDefaults('whiteBalance'), temperature: 20 } },
      'horizontal-charm': { transform: { ...styleParameterDefaults('transform'), rotateY: -15 } },
    } }, loaded: true };
    window.edits = 0;
    const listeners = new Set();
    window.controller = {
      getState: () => state,
      subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
      edit(patch) { edits++; state.draft = { ...state.draft, ...patch }; listeners.forEach(listener => listener(state)); },
    };
    const view = mountDanmakuParameters(document.getElementById('parameters'), controller, { resetButton: document.getElementById('reset') });
    window.disposeParameters = () => { view.dispose(); return listeners.size; };
  });
  await page.locator('.danmaku-advanced > summary').click();
  await page.locator('[data-effect-group="transform"] > summary').click();
  const input = page.locator('[data-effect-field="transform.rotateY"]');
  assert.equal(await page.locator('#danmakuFixedMotion [data-effect-field="transform.rotateY"]').count(), 1);
  assert.equal(await page.locator('#danmakuAppearanceEffects [data-effect-group="transform"]').count(), 0);
  assert.equal(await input.inputValue(), '25');
  await input.fill('-30');
  await input.press('Tab');
  assert.equal(await page.evaluate(() => edits), 1, 'one confirmed change produces one edit');
  assert.equal(await page.evaluate(() => state.draft.styleParameters.glowy.transform.rotateY), -30);
  assert.equal(await page.evaluate(() => state.draft.styleParameters.glowy.transform.rotateZ), 7);
  const resetEffects = page.getByRole('button', { name: '恢复当前样式效果', exact: true });
  await resetEffects.click();
  assert.equal(await page.evaluate(() => state.draft.styleParameters.glowy.whiteBalance), undefined);
  assert.equal(await page.evaluate(() => state.draft.styleParameters.glowy.transform.rotateY), -30);
  assert.equal(await resetEffects.isDisabled(), true, 'perspective alone does not enable filter reset');
  await page.evaluate(() => controller.edit({ style: 'horizontal-charm' }));
  assert.equal(await page.locator('#danmakuFixedMotion').isVisible(), false);
  assert.equal(await page.locator('.component-parameter-advanced [data-effect-field="transform.rotateY"]').count(), 1);
  await page.locator('.component-parameter-advanced > summary').click();
  assert.equal(await input.inputValue(), '-15');
  await resetEffects.click();
  assert.equal(await page.evaluate(() => state.draft.styleParameters['horizontal-charm'].transform), undefined);
  await page.evaluate(() => controller.edit({ style: 'glowy' }));
  assert.equal(await input.inputValue(), '-30');
  await input.focus();
  await page.evaluate(() => controller.edit({ styleParameters: { ...state.draft.styleParameters,
    glowy: { transform: { ...state.draft.styleParameters.glowy.transform, rotateY: 18 } } } }));
  assert.equal(await input.inputValue(), '-30', 'a shared draft update preserves input until focus leaves');
  await input.press('Tab');
  await page.waitForFunction(() => document.querySelector('[data-effect-field="transform.rotateY"]').value === '18');
  await page.locator('[data-effect-enabled="transform"]').uncheck();
  assert.equal(await page.evaluate(() => state.draft.styleParameters.glowy.transform), undefined);
  assert.equal(await page.evaluate(() => disposeParameters()), 0);
  assert.equal(await input.count(), 0, 'dispose removes the relocated controls');
});

test('signed perspective control swaps near edges without adding a planar rotation', async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/danmaku.css">
    <div class="danmaku-signal-stage" style="width:560px;height:300px">
      <div id="danmakuFeed" class="draw-danmaku-feed"></div>
    </div><div id="parameters"></div>` });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage();
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async () => {
    const { mountStyleParameters } = await import('/js/shared/component-style-parameter-view.js');
    const { createComponentStyleEffects } = await import('/js/overlays/component-style-effects.js');
    const { createDanmakuFeed } = await import('/js/overlays/danmaku-feed.js');
    document.body.dataset.style = 'glowy';
    const effects = createComponentStyleEffects(document);
    window.state = { draft: { style: 'glowy' }, loaded: true };
    const listeners = new Set();
    const controller = {
      getState: () => state,
      subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
      edit(patch) {
        state.draft = { ...state.draft, ...patch };
        effects.update('danmaku', state.draft);
        listeners.forEach(listener => listener(state));
      },
    };
    const feed = createDanmakuFeed(document.getElementById('danmakuFeed'), { style: 'glowy', autoScroll: false, expireItems: false });
    feed.render([{ name: '观众', message: '左右两边改变远近，中心保持水平。' }]);
    const card = document.querySelector('.glowy-item');
    for (const side of ['left', 'right']) {
      const edge = document.createElement('span');
      edge.dataset.edge = side;
      edge.style.cssText = `position:absolute;${side}:0;top:0;bottom:0;width:0;pointer-events:none`;
      card.append(edge);
    }
    const view = mountStyleParameters(document.getElementById('parameters'), controller, 'danmaku');
    window.disposePerspective = () => { view.dispose(); effects.dispose(); feed.destroy(); };
  });
  await page.locator('.component-parameter-advanced > summary').click();
  await page.locator('[data-effect-group="transform"] > summary').click();
  await page.locator('[data-effect-enabled="transform"]').check();
  const input = page.locator('[data-effect-field="transform.rotateY"]');
  assert.equal(await input.inputValue(), '0');
  for (const angle of [-30, 0, 30]) {
    await input.fill(String(angle));
    await input.press('Tab');
    const result = await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const left = document.querySelector('[data-edge="left"]').getBoundingClientRect();
      const right = document.querySelector('[data-edge="right"]').getBoundingClientRect();
      return { leftHeight: left.height, rightHeight: right.height,
        centers: Math.abs((left.top + left.bottom) / 2 - (right.top + right.bottom) / 2),
        rotateZ: state.draft.styleParameters.glowy.transform.rotateZ };
    });
    assert.equal(result.rotateZ, 0);
    assert.ok(result.centers < .1, 'sideways perspective keeps the edge centers level');
    if (angle === 0) assert.ok(Math.abs(result.leftHeight - result.rightHeight) < .1);
    else assert.equal(result.leftHeight > result.rightHeight, angle > 0, `${angle}: near edge appears larger`);
  }
  const bubbleOffsets = await page.evaluate(async () => {
    const { effectTransform } = await import('/js/overlays/component-effect-filters.js');
    const { projectSinkingPoint } = await import('/js/overlays/danmaku-sinking-geometry.js');
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:160px;transform-origin:0 0';
    const marker = document.createElement('span');
    marker.style.cssText = 'position:absolute;width:0;height:0';
    probe.append(marker); document.body.append(probe);
    const offsets = [];
    for (const perspective of [400, 2400]) {
      const transform = { rotateY: 35, perspective };
      probe.style.transform = effectTransform(transform);
      for (const point of [{ x: 40, y: 20 }, { x: 360, y: 130 }]) {
        marker.style.left = `${point.x}px`; marker.style.top = `${point.y}px`;
        const actual = marker.getBoundingClientRect();
        const projected = projectSinkingPoint(point, 400, 160, { pitch: 0, yaw: 0, angle: 0, depth: 0 }, transform);
        offsets.push(Math.hypot(actual.left - projected.x, actual.top - projected.y));
      }
    }
    probe.remove();
    return offsets;
  });
  assert.ok(bubbleOffsets.every(offset => offset < .1), `sinking bubbles follow the painted perspective: ${bubbleOffsets}`);
  await page.evaluate(() => disposePerspective());
});

test('every clock and danmaku preset applies supported effects, preserves animation and restores authored styles', { timeout: 45000 }, async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: '<!doctype html><iframe sandbox="allow-scripts" style="width:900px;height:650px;border:0"></iframe>' });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  assert.equal((await fetch(`${fixture.origin}/preview-test-host`)).status, 200);
  await page.goto(`${fixture.origin}/preview-test-host`);
  for (const type of ['clock', 'danmaku']) for (const style of Object.keys(contract.STYLE_PARAMETER_CAPABILITIES[type])) {
    const groups = Object.fromEntries(contract.styleParameterCapabilities(type, { style })
      .map(group => [group, contract.styleParameterDefaults(group)]));
    groups.transform = { perspective: 1600, rotateX: 15, rotateY: -10, rotateZ: 12, skewX: 4, skewY: 0 };
    const config = { style, showDate: true, showSeconds: true, styleOptions: {}, fullscreenDurationSeconds: 30 };
    const url = `${fixture.origin}/${type}?componentPreview=1&sceneComponent=1&preview=1&componentLayer=1`;
    assert.equal((await fetch(url)).status, 200);
    await page.evaluate(({ url, config }) => {
      window.prepared = 0;
      window.onmessage = event => {
        if (event.data?.type === 'component-preview:ready') document.querySelector('iframe').contentWindow
          .postMessage({ type: 'component-preview:init', config }, '*');
        if (event.data?.type === 'component-preview:prepared') window.prepared++;
      };
      document.querySelector('iframe').src = url;
    }, { url, config });
    await page.waitForFunction(() => window.prepared === 1);
    const frame = await (await page.locator('iframe').elementHandle()).contentFrame();
    const addMessages = async () => page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({
      type: 'component-preview:data', data: { status: 'connected', epoch: 'qa', state: { liveStatus: 1, liveSessionId: 'qa' },
        events: [{ type: 'danmaku', liveSessionId: 'qa', name: '观众', message: '测试效果与旋转' },
          { type: 'gift', liveSessionId: 'qa', name: '观众', giftName: '礼物', giftCount: 1 },
          { type: 'superchat', liveSessionId: 'qa', name: '观众', message: '醒目留言', price: 30 }] },
    }, '*'));
    if (type === 'danmaku') await addMessages();
    const selector = type === 'clock' ? '#clockCard' : '#danmakuFeed > .draw-danmaku-item';
    await frame.locator(selector).first().waitFor();
    const send = async value => {
      const before = await page.evaluate(() => window.prepared);
      await page.evaluate(config => document.querySelector('iframe').contentWindow.postMessage({ type: 'component-preview:config', config }, '*'), value);
      await page.waitForFunction(before => window.prepared > before, before);
    };
    await send({ ...config, styleParameters: { [style]: groups } });
    if (type === 'danmaku') { await addMessages(); await frame.locator(selector).first().waitFor(); }
    assert.ok(await frame.locator('[style*="text-stroke"]').count(), `${type}/${style}: text target`);
    if (type === 'danmaku' && style === 'stardust') {
      const events = frame.locator('.stardust-event');
      assert.ok(await events.count(), 'event labels are present');
      assert.ok(await events.evaluateAll(nodes => nodes.every(node => node.style.webkitTextStroke.includes('1px'))),
        'event labels share the text effect with messages and names');
      assert.equal(await frame.locator('.stardust-ornament [style*="text-stroke"]').count(), 0);
    }
    assert.ok(await frame.locator('[style*="--component-transform"]').count(), `${type}/${style}: transform target`);
    assert.match(await frame.locator('[style*="--component-transform"]').first()
      .evaluate(node => node.style.getPropertyValue('--component-transform')), /perspective\(1600px\)/, `${type}/${style}: shared perspective`);
    if (groups.innerShadow) assert.ok(await frame.locator('[style*="box-shadow"]').count(), `${type}/${style}: panel target`);
    if (type === 'danmaku' && style === 'window') {
      const superchatFrame = frame.locator('.window-item[data-window-kind="sc"] .window-frame').first();
      await superchatFrame.waitFor();
      assert.notEqual(await superchatFrame.evaluate(node => node.style.boxShadow), '', 'Window SC retains the configured panel effects.');
    }
    if (['floating', 'comet'].includes(style)) {
      assert.ok(await frame.locator(selector).first().evaluate(node =>
        node.getAnimations().some(animation => !animation.animationName)
          && !new DOMMatrix(getComputedStyle(node).transform).is2D), `${style}: travel retains the configured 3D rotation`);
    }
    await send(config);
    assert.equal(await frame.locator('[data-component-effect-filters]').count(), 0, `${style}: filter cleanup`);
    assert.equal(await frame.locator('[style*="--component-transform"]').count(), 0, `${style}: transform cleanup`);
    assert.equal(await frame.locator('[style*="text-stroke"]').count(), 0, `${style}: text cleanup`);
    if (style === 'moonlit-fan') assert.match(await frame.locator('.clock-moon-face').evaluate(node => getComputedStyle(node).filter), /drop-shadow/);
  }
  assert.deepEqual(errors, []);
});

test('Glass applies panel and text effects to every message while retaining rotation during live entry', { timeout: 15000 }, async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/danmaku.css">
    <body data-style="glass"><div class="danmaku-signal-stage" style="width:696px;height:900px">
      <div id="danmakuFeed" class="draw-danmaku-feed"></div>
    </div></body>` });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage({ viewport: { width: 720, height: 940 } });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const { createComponentStyleEffects } = await import('/js/overlays/component-style-effects.js');
    const { createDanmakuFeed } = await import('/js/overlays/danmaku-feed.js');
    const { applyStyleOptions } = await import('/js/overlays/danmaku-style-application.js');
    applyStyleOptions(document, 'glass', {});
    const effects = createComponentStyleEffects(document);
    const feed = createDanmakuFeed(document.getElementById('danmakuFeed'), {
      style: 'glass', offscreenViewports: 0, autoScroll: false, expireItems: false,
    });
    const timestamp = Date.now();
    feed.render([
      { kind: 'superchat', name: '留言观众', message: '完整留言', price: 30, timestamp },
      { kind: 'gift', name: '礼物观众', giftName: '小花花', giftCount: 2, timestamp },
      { name: '聊天观众', message: '正常弹幕', timestamp },
    ]);
    const panels = () => [...document.querySelectorAll('.glass-panel')];
    const authoredBorder = getComputedStyle(panels()[0]).borderColor;
    effects.update('danmaku', { style: 'glass', styleParameters: { glass: {
      outline: { width: 3, color: '#22ff88', opacity: 100 },
      innerShadow: { x: 0, y: 2, blur: 12, color: '#ff0000', opacity: 80 },
      textOutline: { width: 1, color: '#000000', opacity: 100 },
      transform: { rotateZ: 6 },
    } } });
    const panelEffects = panels().map(panel => ({ border: getComputedStyle(panel).borderColor,
      shadow: getComputedStyle(panel).boxShadow }));
    const strokes = [...document.querySelectorAll('.glass-time, .glass-event-label')]
      .map(node => getComputedStyle(node).webkitTextStrokeWidth);
    feed.append({ name: '新消息', message: '入场保留旋转', timestamp });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const newest = document.querySelector('.glass-item:last-child');
    const entrance = newest.getAnimations().find(animation => animation.animationName === 'glassEntry');
    entrance.pause();
    entrance.currentTime = 700;
    const duringEntry = new DOMMatrix(getComputedStyle(newest).transform).b;
    const newBorder = getComputedStyle(newest.querySelector('.glass-panel')).borderColor;
    effects.update('danmaku', { style: 'glass' });
    const restored = panels().every(panel => getComputedStyle(panel).borderColor === authoredBorder);
    const cleared = !document.querySelector('[style*="--component-transform"], [style*="text-stroke"]');
    effects.dispose(); feed.destroy();
    return { panelEffects, strokes, duringEntry, newBorder, restored, cleared };
  });
  assert.equal(result.panelEffects.length, 3);
  for (const panel of result.panelEffects) {
    assert.equal(panel.border, 'rgb(34, 255, 136)');
    assert.match(panel.shadow, /rgba\(255, 0, 0, 0\.8\).*inset|inset.*rgba\(255, 0, 0, 0\.8\)/);
  }
  assert.ok(result.strokes.length >= 4 && result.strokes.every(width => width === '1px'));
  assert.ok(Math.abs(result.duringEntry - Math.sin(6 * Math.PI / 180)) < 0.001,
    'the entrance must compose with the configured rotation');
  assert.equal(result.newBorder, 'rgb(34, 255, 136)');
  assert.ok(result.restored && result.cleared, 'removing parameters restores the authored appearance');
});

test('dark moon text effects cover chat, room role and alert lettering without replaying messages', async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/overlays/danmaku.css">
    <body data-style="dark-moon"><div id="danmakuFeed" class="draw-danmaku-feed" style="width:640px;height:900px"></div></body>` });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage();
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const { createComponentStyleEffects } = await import('/js/overlays/component-style-effects.js');
    const { createDanmakuFeed } = await import('/js/overlays/danmaku-feed.js');
    const feed = createDanmakuFeed(document.getElementById('danmakuFeed'), {
      style: 'dark-moon', offscreenViewports: 0, autoScroll: false, expireItems: false,
    });
    feed.render([
      { name: '观众', roomGuardLevel: 3, message: '完整聊天' },
      { kind: 'gift', name: '航海家', giftGuardLevel: 3, giftCount: 1, giftTotalPrice: 198 },
      { kind: 'superchat', name: '留言观众', message: '完整留言', price: 30 },
    ]);
    const cards = [...document.querySelectorAll('.dark-moon-item')];
    const effects = createComponentStyleEffects(document);
    effects.update('danmaku', { style: 'dark-moon', styleParameters: { 'dark-moon': {
      textOutline: { width: 1.5, color: '#000000', opacity: 100 },
    } } });
    const roles = ['.dark-moon-name', '.dark-moon-copy', '.dark-moon-role', '.dark-moon-event-label', '.dark-moon-amount'];
    const outlined = roles.every(selector => [...document.querySelectorAll(selector)]
      .every(node => getComputedStyle(node).webkitTextStrokeWidth === '1.5px'));
    feed.append({ name: '新观众', message: '追加消息也有描边' });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const newest = document.querySelector('.dark-moon-item:last-child');
    const arriving = getComputedStyle(newest.querySelector('.dark-moon-copy')).webkitTextStrokeWidth;
    effects.update('danmaku', { style: 'dark-moon' });
    const cleared = roles.every(selector => [...document.querySelectorAll(selector)]
      .every(node => getComputedStyle(node).webkitTextStrokeWidth === '0px'));
    const retained = cards.every(node => node.isConnected && !node.hasAttribute('data-live-entry'));
    effects.dispose(); feed.destroy();
    return { outlined, arriving, cleared, retained };
  });
  assert.equal(result.outlined, true);
  assert.equal(result.arriving, '1.5px');
  assert.equal(result.cleared, true);
  assert.equal(result.retained, true);
});

test('white balance, levels and Bloom affect native pixels and preserve transparency', { timeout: 20000 }, async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html><style>body{margin:0;background:#203040}#clockCard{margin:30px;width:80px;height:80px;background:rgb(128,128,128)}</style><div id="clockCard"></div>` });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const host = await browser.newPage({ viewport: { width: 240, height: 220 } });
  assert.equal((await fetch(`${fixture.origin}/preview-test-host`)).status, 200);
  await host.setContent(`<style>body{margin:0}</style><iframe sandbox="allow-scripts" src="${fixture.origin}/preview-test-host" style="width:240px;height:220px;border:0"></iframe>`);
  const page = await (await host.locator('iframe').elementHandle()).contentFrame();
  await page.locator('#clockCard').waitFor();
  await page.evaluate(async () => {
    const { createComponentStyleEffects } = await import('/js/overlays/component-style-effects.js');
    window.effects = createComponentStyleEffects(document);
  });
  const pixels = async () => {
    const image = (await host.screenshot()).toString('base64');
    return page.evaluate(async source => {
      const image = new Image(); image.src = `data:image/png;base64,${source}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 220;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return [[70, 70], [25, 70], [210, 190]].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
    }, image);
  };
  const baseline = await pixels();
  await page.evaluate(() => effects.update('clock', { style: 'digital', styleParameters: { digital: { whiteBalance: { temperature: 80, tint: 0 } } } }));
  const warm = await pixels();
  assert.ok(warm[0][0] > baseline[0][0] + 15 && warm[0][2] < baseline[0][2] - 15, JSON.stringify({ baseline, warm }));
  assert.deepEqual(warm[2], baseline[2], 'transparent surroundings keep their background');
  await page.evaluate(() => effects.update('clock', { style: 'digital', styleParameters: { digital: { levels: { black: 0, white: 255, gamma: 2, outputBlack: 0, outputWhite: 255 } } } }));
  assert.ok((await pixels())[0][0] > baseline[0][0] + 25);
  await page.evaluate(() => effects.update('clock', { style: 'digital', styleParameters: { digital: { bloom: { intensity: 100, radius: 20, threshold: 10 } } } }));
  assert.ok((await pixels())[1][0] > baseline[1][0], 'bright-region Bloom reaches outside the artwork');
  await page.evaluate(() => effects.dispose());
  assert.deepEqual(await pixels(), baseline);
  assert.equal(await page.locator('[data-component-effect-filters]').count(), 0);
});

test('isolated HTML supports native whole-frame effects without document access', { timeout: 15000 }, async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html><style>body{margin:20px;background:#203040}iframe{border:0;width:180px;height:180px}</style>
    <iframe sandbox="allow-scripts" srcdoc="<style>body{margin:30px;background:transparent}div{width:80px;height:80px;background:#808080}</style><div></div>"></iframe>` });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage({ viewport: { width: 240, height: 240 } });
  assert.equal((await fetch(`${fixture.origin}/preview-test-host`)).status, 200);
  await page.goto(`${fixture.origin}/preview-test-host`);
  const original = await page.screenshot();
  await page.evaluate(async () => {
    const { createComponentStyleEffects } = await import('/js/overlays/component-style-effects.js');
    window.effects = createComponentStyleEffects(document, { externalFrame: document.querySelector('iframe') });
    effects.update('browser', { styleParameters: { browser: { shadow: { color: '#ff0000', opacity: 100, x: 10, y: 10, blur: 10 } } } });
  });
  assert.notDeepEqual(await page.screenshot(), original, 'the iframe shadow must affect rendered pixels');
  assert.equal(await page.evaluate(() => document.querySelector('iframe').contentDocument), null);
  await page.evaluate(() => effects.update('browser', { styleParameters: { browser: { transform: { rotateZ: 20 } } } }));
  assert.notDeepEqual(await page.screenshot(), original);
  await page.evaluate(() => effects.update('browser', { styleParameters: { browser: { outline: { color: '#ffffff', opacity: 100, width: 8 } } } }));
  assert.notDeepEqual(await page.screenshot(), original, 'the rectangular iframe outline affects pixels');
  await page.evaluate(() => effects.dispose());
  assert.deepEqual(await page.screenshot(), original);
});

test('recognized imported CSS applies effects to existing and arriving messages', { timeout: 15000 }, async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: '<!doctype html><style>body{margin:30px;background:#203040}#app{width:180px}article{display:block;background:#808080;padding:10px;margin:12px}</style><div id="app"></div>' });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage({ viewport: { width: 320, height: 300 } });
  assert.equal((await fetch(`${fixture.origin}/preview-test-host`)).status, 200);
  await page.goto(`${fixture.origin}/preview-test-host`);
  for (const engine of ['blc', 'blivechat']) {
    await page.evaluate(async engine => {
      const { createComponentStyleEffects } = await import('/js/overlays/component-style-effects.js');
      window.effects = createComponentStyleEffects(document);
      const app = document.getElementById('app');
      const item = document.createElement(engine === 'blc' ? 'article' : 'yt-live-chat-text-message-renderer');
      item.className = 'danmaku-item';
      const message = document.createElement('span'); message.id = 'message'; message.className = 'danmaku-message';
      message.textContent = '导入弹幕'; item.append(message); app.replaceChildren(item);
    }, engine);
    const original = await page.screenshot();
    const id = 'a1111111-1111-4111-8111-111111111111';
    await page.evaluate(({ engine, id }) => effects.update('danmaku', {
      cssStyle: { engine, id }, styleParameters: { [`css:${id}`]: {
        shadow: { x: 4, y: 6, blur: 12, color: '#ff0000', opacity: 100 },
        textOutline: { width: 2, color: '#ffffff', opacity: 100 },
        whiteBalance: { temperature: 70, tint: 0 },
      } },
    }), { engine, id });
    assert.notDeepEqual(await page.screenshot(), original);
    await page.evaluate(() => {
      const item = document.querySelector('#app > *').cloneNode(true);
      item.removeAttribute('style'); item.firstChild.removeAttribute('style');
      document.getElementById('app').append(item);
    });
    await page.waitForFunction(() => [...document.querySelectorAll('#app > *')].every(item => item.style.boxShadow.includes('12px')
      && item.firstChild.style.webkitTextStroke.includes('2px')));
    assert.equal(await page.locator('#app > *').first().evaluate(node => node.style.boxShadow.split('12px').length - 1), 1);
    await page.evaluate(() => { document.querySelector('#app').lastChild.remove(); effects.dispose(); });
    assert.deepEqual(await page.screenshot(), original);
  }
});
