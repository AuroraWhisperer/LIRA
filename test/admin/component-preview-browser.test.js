'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');

let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

for (const component of ['clock', 'queue', 'danmaku', 'overtime']) {
  test(`${component} opens a separate browser page and edits/saves through its original controller`, { timeout: 25000 }, async (t) => {
    const fixture = await startComponentPreviewServer({ parentHtml: '<!doctype html><html><body></body></html>' });
    const desktopContext = await browser.newContext();
    const browserContext = await browser.newContext();
    const desktop = await desktopContext.newPage();
    const page = await browserContext.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    desktop.on('pageerror', error => errors.push(error.message));
    t.after(async () => {
      await browserContext.close();
      await desktopContext.close();
      await fixture.close();
      assert.deepEqual(errors, []);
    });
    // The synthetic desktop credential is attached only to the originating
    // context. The external browser has neither preload nor admin credentials.
    await desktop.route('**/api/component-preview', route => route.continue({
      headers: { ...route.request().headers(), Authorization: `Bearer ${fixture.token}` },
    }));
    await desktop.goto(`${fixture.origin}/preview-test-host`);
    await desktop.evaluate(async ({ component, settings }) => {
      const { createComponentConfigController } = await import('/js/admin/component-config-controller.js');
      const { openComponentPreview } = await import('/js/admin/component-preview-dialog.js');
      const { setComponentPreviewPreparation } = await import('/js/admin/component-preview-registry.js');
      const { clockConfigFromSettings } = await import('/js/shared/clock-settings.js');
      const { queueConfigFromSettings } = await import('/js/admin/queue-theme-config.js');
      const { createLayout } = await import('/js/shared/danmaku-layout.js');
      const { normalizeStyleOptions } = await import('/js/shared/danmaku-style-options.js');
      const configs = { clock: clockConfigFromSettings(settings), queue: queueConfigFromSettings(settings),
        danmaku: { style: 'signal', fullscreenDurationSeconds: 6, styleOptions: normalizeStyleOptions({}), layout: createLayout() },
        overtime: { path: '', fit: 'cover' } };
      window.writes = [];
      window.failSave = false;
      window.open = (url) => { window.externalPreviewUrl = url; };
      window.controller = createComponentConfigController({ initial: configs[component], persist: async (draft) => {
        if (window.failSave) throw new Error('模拟保存失败');
        window.writes.push(structuredClone(draft));
        return draft;
      } });
      window.canvasWrites = [];
      window.canvasController = createComponentConfigController({ initial: { document: {
        schemaVersion: 1, id: crypto.randomUUID(), title: '公共画布', canvas: { width: 1920, height: 1080 }, items: [],
      } }, persist: async draft => { window.canvasWrites.push(structuredClone(draft)); return draft; } });
      setComponentPreviewPreparation(() => ({ id: 'canvas', controller: window.canvasController,
        async publish() {
          for (const controller of [window.controller, window.canvasController]) {
            if (controller.getState().dirty && !await controller.save()) throw new Error(controller.getState().error);
          }
          return { publishedVersion: 1 };
        } }));
      window.previewOptions = { id: component, controller: window.controller,
        startActualData: component === 'overtime' ? (emit) => {
          window.emitOvertime = emit;
          emit({ revision: 1, status: 'paused', effectiveRemainingMs: 60000, serverNowMs: Date.now(), rules: [] });
          return () => {};
        } : undefined };
      window.reopen = () => { window.handle = openComponentPreview(window.previewOptions); };
      window.reopen();
    }, { component, settings: DEFAULT_SETTINGS });
    await desktop.waitForFunction(() => window.externalPreviewUrl);
    const url = await desktop.evaluate(() => window.externalPreviewUrl);
    assert.equal(new URL(url).pathname, '/c');
    assert.equal(new URL(url).search, '');
    assert.equal((await fixture.post({ action: 'resolve' }, new URL(url).hash.slice(1))).data.selectedId, component);
    assert.equal(await desktop.locator('dialog').count(), 0);
    const response = await fetch(url);
    assert.equal(response.status, 200);
    await page.goto(url);
    await page.locator('.component-preview-frame').waitFor();
    await page.waitForFunction(() => document.querySelector('.component-preview-load-state')?.hidden);
    assert.equal(await page.evaluate(() => Boolean(window.liraLicense || window.__API_TOKEN__)), false);
    let overtimeHeight;
    if (component === 'overtime') {
      const foreground = page.frameLocator('.component-preview-frame').locator('.overtime-foreground');
      overtimeHeight = await foreground.evaluate(node => Math.ceil(node.getBoundingClientRect().height));
      await desktop.waitForFunction(height => window.canvasController.getState().draft.document.items[0]?.height === height, overtimeHeight);
    }
    await page.getByRole('button', { name: '画布设置', exact: true }).click();
    await page.locator('.preview-canvas-layer-select').click();
    const key = component === 'clock' ? 'label' : component === 'queue' ? 'overlayQueueStyle' : component === 'danmaku' ? 'styleOptions' : 'fit';
    const expected = component === 'clock' ? '网页修改' : component === 'queue' ? 'storybook' : component === 'danmaku' ? { signal: { fontSize: 36 } } : 'contain';
    if (component === 'clock') await page.locator('[data-preview-field="clockCustomLabel"]').fill(expected);
    if (component === 'queue') await page.locator('[data-overlay-style="storybook"]').click();
    if (component === 'danmaku') {
      await page.locator('[data-preview-field="danmakuFontSize"]').fill('36');
      await page.locator('[data-preview-field="danmakuFontSize"]').press('Tab');
    }
    if (component === 'overtime') await page.locator('[data-preview-field="overtimeBackgroundFit"]').selectOption(expected, { force: true });
    await desktop.waitForFunction(({ key, expected }) => JSON.stringify(window.controller.getState().draft[key]) === JSON.stringify(expected), { key, expected });
    if (component === 'queue') {
      // Changing style also edits the automatic height; publish only its settled layout.
      const frame = await page.locator('.component-preview-frame').elementHandle().then(handle => handle.contentFrame());
      await frame.waitForFunction(() => {
        const panel = document.querySelector('.queue-storybook');
        const bounds = panel?.getBoundingClientRect();
        return bounds && Math.abs(innerHeight - bounds.height - 2 * bounds.top) < 1;
      });
      const height = await frame.evaluate(() => innerHeight);
      await desktop.waitForFunction(height => window.canvasController.getState().draft.document.items[0].height === height, height);
    }
    assert.equal(await desktop.evaluate(() => window.writes.length), 0);
    if (component === 'overtime') {
      await page.getByRole('button', { name: '锁定', exact: true }).click();
      await desktop.evaluate(() => window.emitOvertime({ revision: 2, status: 'paused', effectiveRemainingMs: 60000,
        serverNowMs: Date.now(), rules: Array.from({ length: 4 }, (_, index) => ({ enabled: true,
          giftId: String(index), giftName: `礼物 ${index}`, mode: 'fixed', fixedSeconds: 60 })) }));
      const frame = page.frameLocator('.component-preview-frame');
      await frame.locator('.overtime-ticket').nth(3).waitFor();
      const expandedHeight = await frame.locator('.overtime-foreground').evaluate(node => Math.ceil(node.getBoundingClientRect().height));
      assert.equal(await desktop.evaluate(() => window.canvasController.getState().draft.document.items[0].height), overtimeHeight,
        'a locked layer should keep its geometry');
      await page.getByRole('button', { name: '解锁', exact: true }).click();
      await desktop.waitForFunction(height => window.canvasController.getState().draft.document.items[0].height === height, expandedHeight);
      assert.ok(expandedHeight > overtimeHeight, 'gift rules should expand the frame');
      await desktop.evaluate(() => window.emitOvertime({ revision: 3, status: 'paused', effectiveRemainingMs: 60000,
        serverNowMs: Date.now(), rules: [] }));
      await frame.locator('#overtimeGiftGuide').waitFor({ state: 'hidden' });
      await desktop.waitForFunction(height => window.canvasController.getState().draft.document.items[0].height === height, overtimeHeight);
    }
    if (component === 'clock') {
      await desktop.evaluate(() => { window.failSave = true; });
      await page.getByRole('button', { name: '保存并应用', exact: true }).click();
      await page.locator('.preview-canvas-status').filter({ hasText: '模拟保存失败' }).waitFor();
      await page.waitForFunction(() => !document.querySelector('.preview-canvas-apply-actions .primary').disabled);
      assert.equal(await desktop.evaluate(() => window.controller.getState().dirty), true);
      await desktop.evaluate(() => { window.failSave = false; });
    }
    await page.getByRole('button', { name: '保存并应用', exact: true }).click();
    await desktop.waitForFunction(() => window.writes.length === 1);
    await page.getByRole('status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
    assert.deepEqual(await desktop.evaluate(key => window.writes[0][key], key), expected);
    if (component === 'overtime') {
      await page.getByRole('button', { name: '加班机展示数据', exact: true }).click();
      await page.getByRole('option', { name: '示例 · 运行中', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: '设置并重置倒计时' }).isVisible(), false);
      assert.equal(await desktop.evaluate(() => window.writes.length), 1);
    }
    await desktop.evaluate(() => window.handle.close());
    await page.waitForFunction(() => document.querySelector('.preview-canvas-apply-actions .primary').disabled);
    await desktop.evaluate(() => { window.externalPreviewUrl = ''; window.reopen(); });
    await desktop.waitForFunction(() => window.externalPreviewUrl);
    const reopened = await desktop.evaluate(() => window.externalPreviewUrl);
    assert.notEqual(reopened, url);
  });
}

test('clock frames keep each style within its frame and publish the saved output size', { timeout: 30000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  fixture.configs.clock.style = fixture.runtime.settings.clockStyle = 'flip';
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  t.after(async () => { await context.close(); await fixture.close(); });
  const desktop = await context.newPage();
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    window.addEventListener('message', event => {
      if (event.data?.type === 'component-preview:resize') window.previewSize = event.data.size;
    });
  });
  const url = await openCanvasDesktop(desktop, fixture, 'clock');
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.frameLocator('iframe').locator('#clockCard:not([hidden])').waitFor();
  const frame = page.frames().find(value => new URL(value.url()).pathname === '/clock');
  const setWidth = async width => {
    await page.getByRole('spinbutton', { name: '宽度', exact: true }).fill(String(width));
    await page.getByRole('spinbutton', { name: '宽度', exact: true }).press('Tab');
    await frame.waitForFunction(expected => innerWidth === expected, width, { timeout: 5000 });
  };
  const settledSize = async () => {
    await page.waitForFunction(() => {
      const frame = document.querySelector('.scene-editor-item iframe');
      const size = window.previewSize;
      return size && frame.clientWidth === size.contentWidth && frame.clientHeight === size.height
        && document.querySelector('.scene-editor-item-label').textContent
        .endsWith(`${frame.clientWidth} × ${frame.clientHeight} px`);
    }, null, { timeout: 5000 });
    return frame.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  };
  await setWidth(462);
  const flipFrame = await settledSize();
  const styleSelect = page.locator('[data-preview-field="clockCurrentStyle"]');
  const styles = await styleSelect.locator('option').evaluateAll(options => options.map(option => option.value));
  // Finish on flip: its saved frame is the published output size below.
  for (const style of [...styles.filter(value => value !== 'flip'), 'flip']) {
    await styleSelect.selectOption(style, { force: true });
    await frame.waitForFunction(expected => document.documentElement.dataset.clockStyle === expected, style, { timeout: 5000 });
    await frame.waitForFunction(() => {
      const card = document.getElementById('clockCard');
      const scale = Number(card.style.getPropertyValue('--clock-scale'));
      return Math.abs(scale - 1) < 0.02;
    }, null, { timeout: 5000 });
    const fixedFrame = { flip: [462, flipFrame.height] }[style];
    if (fixedFrame) await frame.waitForFunction(([width, height]) => innerWidth === width && innerHeight === height,
      fixedFrame, { timeout: 5000 });
    await settledSize();
    const clipped = await frame.locator('.clock-time > span, .clock-date-row > span, .clock-year, .clock-period').evaluateAll(nodes =>
      nodes.filter(node => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1);
      }).map(node => node.id));
    assert.deepEqual(clipped, [], `${style} must keep all visible fields within its frame`);
  }
  await desktop.waitForFunction(() => window.controllers.clock.getState().draft.style === 'flip', null, { timeout: 5000 });
  fixture.runtime.settings.clockLabel = await desktop.evaluate(() => window.controllers.clock.getState().draft.label);
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
  assert.deepEqual(fixture.service.getComponentSize('clock'), { width: 462, height: flipFrame.height });
  const outputUrl = `${fixture.origin}/clock`;
  assert.equal((await fetch(outputUrl)).status, 200);
  const output = await context.newPage();
  await output.goto(outputUrl);
  await output.waitForFunction(() => document.documentElement.style.getPropertyValue('--component-width') === '462px', null, { timeout: 5000 });
});

test('legacy moon clock settings remain editable, publish and alternate tones automatically', { timeout: 25000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  fixture.runtime.settings.clockStyle = 'moonlit-fan';
  fixture.configs.clock = require('../../src/server/clock-contract').getClockConfig(fixture.runtime.settings);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  let releaseModeAck;
  const modeAckReleased = new Promise(resolve => { releaseModeAck = resolve; });
  t.after(async () => {
    releaseModeAck();
    await context.close();
    await fixture.close();
    assert.deepEqual(errors, []);
  });
  const desktop = await context.newPage();
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  desktop.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(5000);
  desktop.setDefaultTimeout(5000);
  let holdModeAck = true;
  let receiveModeAck;
  const modeAckHeld = new Promise(resolve => { receiveModeAck = resolve; });
  await page.route('**/api/component-preview', async route => {
    if (!holdModeAck || route.request().postDataJSON().action !== 'read-batch') return route.continue();
    const response = await route.fetch();
    const payload = await response.json();
    const clock = payload.data?.updates?.find(update => update.state?.draft?.moonMode === 'auto');
    if (clock) {
      holdModeAck = false;
      receiveModeAck(clock);
      await modeAckReleased;
    }
    await route.fulfill({ response });
  });
  const url = await openCanvasDesktop(desktop, fixture, 'clock');
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.frameLocator('iframe').locator('#clockCard:not([hidden])').waitFor();
  const frame = page.frames().find(value => new URL(value.url()).pathname === '/clock');
  const mode = page.locator('[data-preview-field="clockMoonMode"]');
  const interval = page.locator('[data-preview-field="clockMoonIntervalSeconds"]');
  await frame.locator('#clockCard[data-moon-tone="light"]').waitFor();
  await mode.selectOption('auto', { force: true });
  const clockAck = await modeAckHeld;
  await interval.fill('02');
  const ackConsumed = page.waitForRequest(request => {
    if (!request.url().endsWith('/api/component-preview')) return false;
    const body = request.postDataJSON();
    return body?.action === 'read-batch' && body.entries.some(entry => entry.id === clockAck.id
      && entry.stateRevision === clockAck.stateRevision && entry.ack === clockAck.ack);
  });
  releaseModeAck();
  await ackConsumed;
  assert.equal(await interval.inputValue(), '02', 'a delayed mode acknowledgement preserves the focused interval edit');
  await interval.press('Tab');
  await desktop.waitForFunction(() => {
    const draft = window.controllers.clock.getState().draft;
    return draft.moonMode === 'auto' && draft.moonIntervalSeconds === 2;
  });
  assert.equal(await interval.inputValue(), '2', 'leaving the field restores the normalized committed value');
  // The fixture's controller returns its draft; mirror the pending write into
  // its synthetic runtime for the shared-scene publication consistency check.
  const { clockSettingsPayload } = require('../../public/js/shared/clock-settings.js');
  const draft = await desktop.evaluate(() => window.controllers.clock.getState().draft);
  Object.assign(fixture.runtime.settings, clockSettingsPayload(draft));
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
  const saved = await desktop.evaluate(() => window.controllers.clock.getState().saved);
  assert.equal(saved.moonMode, 'auto');
  assert.equal(saved.moonIntervalSeconds, 2);
  const sceneId = await desktop.evaluate(() => window.controllers.canvas.getState().saved.document.id);
  const source = fixture.service.getSource(sceneId);
  assert.deepEqual(fixture.service.getOutput({ id: source.id, token: source.token }).document.items[0].appearance.config, saved);
  const outputUrl = `${fixture.origin}/clock`;
  assert.equal((await fetch(outputUrl)).status, 200);
  const output = await context.newPage();
  output.on('pageerror', error => errors.push(error.message));
  await output.goto(outputUrl);
  await output.locator('#clockCard:not([hidden])[data-clock-style="moonlit-fan"]').waitFor();
  await page.reload();
  await page.frameLocator('iframe').locator('#clockCard:not([hidden])').waitFor();
  assert.equal(await mode.inputValue(), 'auto');
  assert.equal(await interval.inputValue(), '2');
  const reloadedFrame = page.frames().find(value => new URL(value.url()).pathname === '/clock');
  let tone = await output.locator('#clockCard').getAttribute('data-moon-tone');
  tone = tone === 'light' ? 'dark' : 'light';
  await output.locator(`#clockCard[data-moon-tone="${tone}"]`).waitFor({ timeout: 3500 });
  await reloadedFrame.locator(`#clockCard[data-moon-tone="${tone}"]`).waitFor({ timeout: 1000 });
  await mode.selectOption('dark', { force: true });
  await reloadedFrame.locator('#clockCard[data-moon-tone="dark"]').waitFor();
});

test('shared canvas retains multiple layers, custom resolution and drafts, and drains every save on closure', { timeout: 45000 }, async (t) => {
  const fixture = await startComponentPreviewServer({ parentHtml: '<!doctype html><html><body></body></html>' });
  const desktopContext = await browser.newContext();
  const browserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desktop = await desktopContext.newPage();
  const page = await browserContext.newPage();
  const errors = [];
  let holdExchanges = false;
  const heldExchanges = new Set();
  let onExchangesHeld;
  let resumeExchanges;
  const exchangesHeld = new Promise(resolve => { onExchangesHeld = resolve; });
  const exchangesResumed = new Promise(resolve => { resumeExchanges = resolve; });
  page.on('pageerror', error => errors.push(error.message));
  desktop.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    resumeExchanges();
    await browserContext.close();
    await desktopContext.close();
    await fixture.close();
    assert.deepEqual(errors, []);
  });
  await desktop.route('**/api/component-preview', async route => {
    const body = route.request().postDataJSON();
    const exchanges = body.action === 'exchange-batch' ? body.entries : body.action === 'exchange' ? [body] : [];
    if (holdExchanges && exchanges.length) {
      for (const { id } of exchanges) heldExchanges.add(id);
      if (heldExchanges.size === 5) onExchangesHeld();
      await exchangesResumed;
    }
    await route.continue({ headers: { ...route.request().headers(), Authorization: `Bearer ${fixture.token}` } });
  });
  await desktop.goto(`${fixture.origin}/preview-test-host`);
  await desktop.evaluate(async settings => {
    const { createComponentConfigController } = await import('/js/admin/component-config-controller.js');
    const { openComponentPreview } = await import('/js/admin/component-preview-dialog.js');
    const { registerComponentPreview, setComponentPreviewPreparation } = await import('/js/admin/component-preview-registry.js');
    const { clockConfigFromSettings } = await import('/js/shared/clock-settings.js');
    const { queueConfigFromSettings } = await import('/js/admin/queue-theme-config.js');
    const { createLayout } = await import('/js/shared/danmaku-layout.js');
    window.writes = [];
    window.closedComponents = [];
    window.controllers = {};
    window.open = url => { window.externalPreviewUrl = url; };
    const configs = { clock: clockConfigFromSettings(settings), queue: queueConfigFromSettings(settings),
      danmaku: { style: 'signal', fullscreenDurationSeconds: 6, layout: createLayout() },
      overtime: { path: '', fit: 'cover' },
      canvas: { document: { schemaVersion: 1, id: crypto.randomUUID(), title: '共享画布',
        canvas: { width: 1920, height: 1080 }, items: [] } } };
    for (const [id, initial] of Object.entries(configs)) {
      const controller = createComponentConfigController({ initial, persist: async draft => {
        window.writes.push({ id, draft });
        return draft;
      } });
      window.controllers[id] = controller;
      const options = () => ({ id, controller, onClose: () => window.closedComponents.push(id),
        async publish() {
          for (const current of Object.values(window.controllers)) if (current.getState().dirty) await current.save();
          return { publishedVersion: 1 };
        } });
      if (id === 'canvas') setComponentPreviewPreparation(options);
      else registerComponentPreview(id, options);
    }
    window.reopen = () => openComponentPreview({ id: 'clock', controller: window.controllers.clock,
      onClose: () => window.closedComponents.push('clock') });
    window.reopen();
  }, DEFAULT_SETTINGS);
  await desktop.waitForFunction(() => window.externalPreviewUrl);
  const url = await desktop.evaluate(() => window.externalPreviewUrl);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('.component-preview-load-state')?.hidden);
  let idleRequests = 0;
  const countIdle = request => {
    if (request.url().endsWith('/api/component-preview')
      && ['read', 'exchange'].includes(request.postDataJSON()?.action)) idleRequests++;
  };
  page.on('request', countIdle);
  desktop.on('request', countIdle);
  await page.waitForTimeout(2000);
  page.off('request', countIdle);
  desktop.off('request', countIdle);
  assert.ok(idleRequests <= 20, `five idle sessions sent ${idleRequests} requests in two seconds`);
  t.diagnostic(`five-session idle requests over two seconds: ${idleRequests}`);
  const names = { clock: '萌时钟', queue: '点歌板', danmaku: '弹幕姬', overtime: '加班机' };
  const add = async id => {
    await page.getByRole('button', { name: '添加组件', exact: true }).click();
    await page.locator(`[data-category="${id}"]`).click();
    await page.locator('.preview-picker-style').first().click();
  };
  const choose = async id => {
    const layer = page.locator('.preview-canvas-layer-select').filter({ hasText: `${names[id]} 1` });
    if (await layer.count()) await layer.click();
    else await add(id);
  };
  await page.locator('[data-preview-field="clockCustomLabel"]').fill('切换后保留');
  await choose('queue');
  await page.locator('[data-overlay-style="storybook"]').click();
  await choose('clock');
  assert.equal(await page.locator('[data-preview-field="clockCustomLabel"]').inputValue(), '切换后保留');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await desktop.waitForFunction(() => window.writes.length === 2);
  assert.deepEqual(await desktop.evaluate(() => window.writes.map(write => write.id).sort()), ['canvas', 'clock']);
  assert.equal(await desktop.evaluate(() => window.controllers.queue.getState().dirty), false);
  const width = page.getByRole('spinbutton', { name: '宽度', exact: true });
  const savedWidth = await width.inputValue();
  await width.fill('581');
  await width.press('Tab');
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.getByRole('dialog', { name: '放弃未保存的修改？', exact: true }).getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.locator('.lira-confirm-backdrop').waitFor({ state: 'detached' });
  assert.equal(await width.inputValue(), savedWidth);
  for (const id of ['danmaku', 'overtime', 'queue', 'clock', 'queue']) await choose(id);
  await add('clock');
  assert.equal(await page.locator('iframe').count(), 5);
  for (const [name, value] of [['宽度', '610'], ['X', '100'], ['Y', '100']]) {
    await page.getByRole('spinbutton', { name, exact: true }).fill(value);
    await page.getByRole('spinbutton', { name, exact: true }).press('Tab');
  }
  const moving = page.locator('.scene-editor-item[aria-label="萌时钟 2"]');
  const box = await moving.boundingBox();
  await page.mouse.move(box.x + 12, box.y + 12);
  await page.mouse.down(); await page.mouse.move(box.x + 52, box.y + 42, { steps: 8 }); await page.mouse.up();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.at(-1).x !== 100);
  await page.getByRole('button', { name: '画布设置', exact: true }).click();
  await page.getByRole('button', { name: '公共画布分辨率', exact: true }).click();
  await page.getByRole('option', { name: '2560 × 1440', exact: true }).click();
  for (const [name, value] of [['画布宽度', '2000'], ['画布高度', '1200']]) {
    await page.getByRole('spinbutton', { name, exact: true }).fill(value);
    if (name === '画布宽度') {
      const overtime = page.locator('.scene-editor-item[data-component="overtime"]');
      const height = await overtime.evaluate(node => node.offsetHeight);
      // Change real content so its ResizeObserver cannot overwrite a synthetic size with the old height.
      await overtime.frameLocator('iframe').locator('.overtime-foreground').evaluate((node, height) => {
        node.style.minHeight = `${height + 31}px`;
      }, height);
      await page.waitForFunction(expected => document.querySelector('.scene-editor-item[data-component="overtime"]').offsetHeight === expected, height + 31);
      assert.equal(await page.getByRole('spinbutton', { name, exact: true }).inputValue(), value);
    }
    await page.getByRole('spinbutton', { name, exact: true }).press('Tab');
  }
  assert.deepEqual(await page.locator('.scene-editor-canvas').evaluate(node => [node.offsetWidth, node.offsetHeight]), [2000, 1200]);
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await desktop.waitForFunction(() => window.writes.length === 3);
  assert.equal(await desktop.evaluate(() => window.writes.at(-1).id), 'canvas');
  await page.goto('about:blank');
  assert.equal(await desktop.evaluate(() => window.closedComponents.length), 0, 'Leaving the page preserves the desktop session.');
  await desktop.evaluate(() => { window.externalPreviewUrl = ''; window.reopen(); });
  await desktop.waitForFunction(() => window.externalPreviewUrl);
  assert.deepEqual(await desktop.evaluate(() => window.closedComponents), [], 'Reopening must reuse the desktop sessions.');
  assert.equal(await desktop.evaluate(() => window.externalPreviewUrl), url);
  await page.goto(await desktop.evaluate(() => window.externalPreviewUrl));
  await page.locator('[data-preview-field="clockCustomLabel"]').waitFor();
  assert.equal(await page.locator('[data-preview-field="clockCustomLabel"]').inputValue(), '切换后保留');
  assert.equal(await page.locator('iframe').count(), 5);
  assert.deepEqual(await page.locator('.scene-editor-canvas').evaluate(node => [node.offsetWidth, node.offsetHeight]), [2000, 1200]);

  // Accepted commands for every component must drain even when the browser closes first.
  await page.locator('[data-preview-field="clockCustomLabel"]').fill('关闭后也保存');
  await choose('queue');
  await page.locator('[data-overlay-style="storybook"]').waitFor();
  await page.locator('[data-overlay-style="classic"]').click();
  await desktop.waitForFunction(() => window.controllers.clock.getState().draft.label === '关闭后也保存'
    && window.controllers.canvas.getState().draft.document.items.find(item => item.type === 'queue').appearance.config.overlayQueueStyle === 'classic');
  holdExchanges = true;
  await desktop.evaluate(async () => {
    const { setRoomGuardState } = await import('/js/shared/bilibili-room-guard.js');
    setRoomGuardState({ roomId: 'synthetic-test-room', count: 1 });
  });
  await exchangesHeld;
  const closingUrl = new URL(await desktop.evaluate(() => window.externalPreviewUrl));
  const sessions = (await fixture.post({ action: 'resolve' }, closingUrl.hash.slice(1))).data.links;
  for (const session of sessions) {
    const { data } = await fixture.post({ action: 'read', id: session.id }, session.token);
    session.attachmentId = data.attachmentId;
  }
  const canvasSession = sessions.find(session => session.component === 'canvas');
  assert.equal((await fixture.post({ action: 'publish', id: canvasSession.id, attachmentId: canvasSession.attachmentId }, canvasSession.token)).status, 200);
  for (const session of sessions) {
    assert.equal((await fixture.post({ action: 'close', id: session.id, attachmentId: session.attachmentId }, session.token)).status, 200);
  }
  await page.locator('.preview-canvas-status').filter({ hasText: '预览连接已结束' }).waitFor();
  await page.goto('about:blank');
  resumeExchanges();
  await desktop.waitForFunction(() => window.closedComponents.length === 5 && window.writes.length === 5);
  assert.deepEqual(await desktop.evaluate(() => window.writes.slice(3).map(write => write.id).sort()), ['canvas', 'clock']);
  assert.equal(await desktop.evaluate(() => window.controllers.clock.getState().saved.label), '关闭后也保存');
});
