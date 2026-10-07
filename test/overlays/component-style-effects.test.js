const test = require('node:test');
const assert = require('node:assert/strict');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const contract = require('../../public/js/shared/component-style-parameters.js');

const openBrowserSession = useSharedBrowser();

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
    groups.transform = { rotateX: 15, rotateY: -10, rotateZ: 12, skewX: 4, skewY: 0 };
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
    assert.ok(await frame.locator('[style*="--component-transform"]').count(), `${type}/${style}: transform target`);
    if (groups.innerShadow) assert.ok(await frame.locator('[style*="box-shadow"]').count(), `${type}/${style}: panel target`);
    if (style === 'moonlit-fan') assert.equal(await frame.locator('.clock-moon-face').evaluate(node => getComputedStyle(node).filter), 'none');
    if (['floating', 'comet'].includes(style)) {
      assert.ok(await frame.locator(selector).first().evaluate(node => node.getAnimations()
        .some(animation => animation.effect.getKeyframes().some(key => /component-transform|rotateX|matrix3d/.test(String(key.transform))))), style);
    }
    await send(config);
    assert.equal(await frame.locator('[data-component-effect-filters]').count(), 0, `${style}: filter cleanup`);
    assert.equal(await frame.locator('[style*="--component-transform"]').count(), 0, `${style}: transform cleanup`);
    assert.equal(await frame.locator('[style*="text-stroke"]').count(), 0, `${style}: text cleanup`);
    if (style === 'moonlit-fan') assert.match(await frame.locator('.clock-moon-face').evaluate(node => getComputedStyle(node).filter), /drop-shadow/);
  }
  assert.deepEqual(errors, []);
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
