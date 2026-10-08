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
    if (component === 'queue') {
      const help = page.locator('lira-help:visible').first();
      await help.hover();
      assert.equal(await help.getAttribute('aria-expanded'), 'true');
      assert.equal(await help.getByRole('tooltip').isVisible(), true);
      await page.mouse.move(0, 0);
      await help.focus();
      assert.equal(await help.getAttribute('aria-expanded'), 'true');
      await help.press('Escape');
      assert.equal(await help.getAttribute('aria-expanded'), 'false');
    }
    const dimensions = page.locator('.scene-editor-item-label');
    const initialSize = { clock: '580 × 203 px', danmaku: '560 × 600 px' };
    let overtimeHeight;
    let overtimeFont;
    if (component === 'overtime') {
      const foreground = page.frameLocator('.component-preview-frame').locator('.overtime-foreground');
      overtimeHeight = await foreground.evaluate(node => Math.ceil(node.getBoundingClientRect().height));
      await page.waitForFunction(height => document.querySelector('.scene-editor-item-label').textContent.endsWith(`520 × ${height} px`), overtimeHeight);
      assert.ok(overtimeHeight < 220, 'a clock without gift rules should have a compact frame');
      overtimeFont = await page.frameLocator('.component-preview-frame').locator('#overtimeClock').evaluate(node => getComputedStyle(node).fontSize);
      assert.equal(await page.getByRole('spinbutton', { name: '高度（自动）' }).getAttribute('readonly'), '');
      assert.equal(await page.locator('.component-preview-frame').evaluate(node => getComputedStyle(node).colorScheme), 'normal');
      assert.equal(await dimensions.evaluate(node => node.getBoundingClientRect().bottom <= node.closest('.scene-editor-item').getBoundingClientRect().top), true);
    } else if (component === 'queue') {
      const frame = await page.locator('.component-preview-frame').elementHandle().then(handle => handle.contentFrame());
      await frame.waitForFunction(() => {
        const bounds = document.querySelector('.overlay-panel').getBoundingClientRect();
        return Math.abs(innerHeight - bounds.height - 2 * bounds.top) < 1;
      });
      assert.equal(await page.getByRole('spinbutton', { name: '高度（自动）' }).getAttribute('readonly'), '');
    } else {
      await page.waitForFunction(size => document.querySelector('.scene-editor-item-label').textContent.endsWith(size), initialSize[component]);
      assert.ok((await dimensions.textContent()).endsWith(initialSize[component]));
    }
    assert.equal(await dimensions.isVisible(), true);
    const labelHeight = await dimensions.evaluate(node => node.getBoundingClientRect().height);
    await page.getByRole('button', { name: '画布设置', exact: true }).click();
    await dimensions.waitFor({ state: 'hidden' });
    await page.locator('.preview-canvas-layer-select').click();
    const key = component === 'clock' ? 'label' : component === 'queue' ? 'overlayQueueStyle' : component === 'danmaku' ? 'styleOptions' : 'fit';
    const expected = component === 'clock' ? '网页修改' : component === 'queue' ? 'storybook' : component === 'danmaku' ? { signal: { fontSize: 36 } } : 'contain';
    if (component === 'clock') await page.locator('[data-preview-field="clockCustomLabel"]').fill(expected);
    if (component === 'queue') await page.locator('[data-overlay-style="storybook"]').click();
    if (component === 'danmaku') {
      assert.equal(await page.locator('[data-danmaku-style]').count(), 0);
      assert.equal(await page.getByRole('button', { name: /更换样式|改用内置样式/ }).count(), 0);
      await page.locator('[data-preview-field="danmakuFontSize"]').fill('36');
      await page.locator('[data-preview-field="danmakuFontSize"]').press('Tab');
    }
    if (component === 'overtime') await page.locator('[data-preview-field="overtimeBackgroundFit"]').selectOption(expected, { force: true });
    await desktop.waitForFunction(({ key, expected }) => JSON.stringify(window.controller.getState().draft[key]) === JSON.stringify(expected), { key, expected });
    assert.equal(await desktop.evaluate(() => window.writes.length), 0);
    if (component === 'overtime') {
      await page.getByRole('button', { name: '锁定', exact: true }).click();
      await desktop.evaluate(() => window.emitOvertime({ revision: 2, status: 'paused', effectiveRemainingMs: 60000,
        serverNowMs: Date.now(), rules: Array.from({ length: 4 }, (_, index) => ({ enabled: true,
          giftId: String(index), giftName: `礼物 ${index}`, mode: 'fixed', fixedSeconds: 60 })) }));
      const frame = page.frameLocator('.component-preview-frame');
      await frame.locator('.overtime-ticket').nth(3).waitFor();
      const expandedHeight = await frame.locator('.overtime-foreground').evaluate(node => Math.ceil(node.getBoundingClientRect().height));
      assert.ok((await dimensions.textContent()).endsWith(`520 × ${overtimeHeight} px`), 'a locked layer should keep its geometry');
      await page.getByRole('button', { name: '解锁', exact: true }).click();
      await page.waitForFunction(height => document.querySelector('.scene-editor-item-label').textContent.endsWith(`520 × ${height} px`), expandedHeight);
      assert.ok(expandedHeight > overtimeHeight, 'gift rules should expand the frame');
      assert.equal(await frame.locator('#overtimeClock').evaluate(node => getComputedStyle(node).fontSize), overtimeFont);
      await desktop.evaluate(() => window.emitOvertime({ revision: 3, status: 'paused', effectiveRemainingMs: 60000,
        serverNowMs: Date.now(), rules: [] }));
      await frame.locator('#overtimeGiftGuide').waitFor({ state: 'hidden' });
      await page.waitForFunction(height => document.querySelector('.scene-editor-item-label').textContent.endsWith(`520 × ${height} px`), overtimeHeight);
      assert.deepEqual(await desktop.evaluate(() => window.canvasController.getState().draft.document.canvas), { width: 1920, height: 1080 });
    }
    if (component === 'danmaku') {
      assert.equal(await page.getByRole('spinbutton', { name: '画布宽度', exact: true }).count(), 0);
      for (const [name, value] of [['宽度', '720'], ['高度', '240']]) {
        await page.getByRole('spinbutton', { name, exact: true }).fill(value);
        await page.getByRole('spinbutton', { name, exact: true }).press('Tab');
        await desktop.waitForFunction(({ name, value }) => window.canvasController.getState().draft.document.items[0][
          name === '宽度' ? 'width' : 'height'] === Number(value), { name, value });
      }
      await page.waitForFunction(() => document.querySelector('.scene-editor-item-label').textContent.endsWith('720 × 240 px'));
      assert.equal(await dimensions.isVisible(), true);
      assert.equal(await page.frameLocator('.component-preview-frame').locator('.selection-label').isVisible(), false);
      assert.deepEqual(await desktop.evaluate(() => window.canvasController.getState().draft.document.canvas), { width: 1920, height: 1080 });
      await page.getByRole('button', { name: '画布设置', exact: true }).click();
      await page.getByRole('button', { name: '公共画布分辨率', exact: true }).click();
      await page.getByRole('option', { name: '1280 × 720', exact: true }).click();
      await page.locator('.preview-canvas-layer-select').click();
      await page.waitForFunction(() => document.querySelector('.scene-editor-item-label').textContent.endsWith('480 × 160 px'));
      await page.setViewportSize({ width: 1000, height: 700 });
      assert.ok(Math.abs(await dimensions.evaluate(node => node.getBoundingClientRect().height) - labelHeight) < 1);
      for (const name of ['宽度', '高度']) {
        await page.getByRole('spinbutton', { name, exact: true }).fill('64');
        await page.getByRole('spinbutton', { name, exact: true }).press('Tab');
        await desktop.waitForFunction((name) => window.canvasController.getState().draft.document.items[0][
          name === '宽度' ? 'width' : 'height'] === 64, name);
      }
      await page.waitForFunction(() => document.querySelector('.scene-editor-item-label').textContent.endsWith('64 × 64 px'));
      assert.equal(await dimensions.evaluate((node) => {
        const badge = node.getBoundingClientRect();
        const stage = node.closest('.scene-editor-canvas').getBoundingClientRect();
        return badge.left >= stage.left && badge.top >= stage.top && badge.right <= stage.right && badge.bottom <= stage.bottom;
      }), true);
    }
    if (component === 'clock') {
      await desktop.evaluate(() => { window.failSave = true; });
      await page.getByRole('button', { name: '保存并应用', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '模拟保存失败' }).waitFor();
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
      await page.getByRole('button', { name: '演示加时 +1 分钟' }).click();
      assert.equal(await desktop.evaluate(() => window.writes.length), 1);
    }
    await desktop.evaluate(() => window.handle.close());
    await page.getByRole('status').filter({ hasText: '预览连接已结束' }).waitFor();
    await page.waitForFunction(() => document.querySelector('.preview-canvas-status').textContent
      === '预览连接已结束，请从客户端重新打开预览。', null, { timeout: 5000 });
    assert.equal(await page.getByRole('button', { name: '保存并应用', exact: true }).isDisabled(), true);
    await desktop.evaluate(() => { window.externalPreviewUrl = ''; window.reopen(); });
    await desktop.waitForFunction(() => window.externalPreviewUrl);
    const reopened = await desktop.evaluate(() => window.externalPreviewUrl);
    assert.notEqual(reopened, url);
  });
}

test('clock frames follow each style and visible fields, preserve scale, and match saved output', { timeout: 30000 }, async t => {
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
    return frame.evaluate(() => ({ width: innerWidth, height: innerHeight,
      scale: Number(document.getElementById('clockCard').style.getPropertyValue('--clock-scale')) }));
  };
  await setWidth(1624);
  const large = await settledSize();
  const margins = await frame.locator('.clock-content').evaluate(node => {
    const rect = node.getBoundingClientRect();
    return [rect.left, rect.top, innerWidth - rect.right, innerHeight - rect.bottom];
  });
  assert.ok(margins.every(value => value >= 3.9 && value <= 5), 'the selection must hug the flip frame on every side');
  await setWidth(462);
  await frame.waitForFunction(height => innerHeight < height, large.height, { timeout: 5000 });
  const flipFrame = await settledSize();
  const sizes = {};
  const styles = await page.locator('[data-clock-style-option]').evaluateAll(buttons => buttons.map(button => button.dataset.clockStyleOption));
  for (const style of ['peach', 'timeline-horizontal', 'timeline-vertical', 'flip']) assert.ok(styles.includes(style), style);
  // Finish on flip: the following field checks start from its saved frame.
  for (const style of [...styles.filter(value => value !== 'flip'), 'flip']) {
    await page.locator(`[data-clock-style-option="${style}"]`).click();
    await frame.waitForFunction(expected => document.documentElement.dataset.clockStyle === expected, style, { timeout: 5000 });
    await frame.waitForFunction(() => {
      const card = document.getElementById('clockCard');
      const scale = Number(card.style.getPropertyValue('--clock-scale'));
      return Math.abs(scale - 1) < 0.02;
    }, null, { timeout: 5000 });
    const fixedFrame = { flip: [462, flipFrame.height] }[style];
    if (fixedFrame) await frame.waitForFunction(([width, height]) => innerWidth === width && innerHeight === height,
      fixedFrame, { timeout: 5000 });
    sizes[style] = await settledSize();
    const clipped = await frame.locator('.clock-time > span, .clock-date-row > span, .clock-year, .clock-period').evaluateAll(nodes =>
      nodes.filter(node => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1);
      }).map(node => node.id));
    assert.deepEqual(clipped, [], `${style} must keep all visible fields within its frame`);
  }
  assert.ok(sizes['timeline-horizontal'].height < sizes.peach.height / 2);
  assert.ok(sizes['timeline-vertical'].width < sizes['timeline-vertical'].height / 2);
  assert.ok(sizes.flip.width < sizes.peach.width && sizes.flip.height < sizes.peach.height, JSON.stringify(sizes));
  const full = sizes.flip;
  await page.locator('[data-preview-field="clockShowSeconds"]').uncheck();
  await frame.waitForFunction(width => innerWidth < width - 50, full.width, { timeout: 5000 });
  const withoutSeconds = await settledSize();
  assert.ok(Math.abs(withoutSeconds.scale - full.scale) < 0.02);
  assert.equal(withoutSeconds.height, full.height);
  await page.locator('[data-preview-field="clockShowDate"]').uncheck();
  await frame.waitForFunction(width => innerWidth < width - 50, withoutSeconds.width, { timeout: 5000 });
  await page.locator('[data-preview-field="clockHourFormat"]').selectOption('12', { force: true });
  await frame.waitForFunction(height => innerHeight > height + 20, full.height, { timeout: 5000 });
  for (const field of ['clockShowDate', 'clockShowSeconds']) await page.locator(`[data-preview-field="${field}"]`).check();
  await page.locator('[data-preview-field="clockHourFormat"]').selectOption('24', { force: true });
  await frame.waitForFunction(height => innerWidth === 462 && innerHeight === height, flipFrame.height, { timeout: 5000 });
  await desktop.waitForFunction(() => {
    const draft = window.controllers.clock.getState().draft;
    return draft.style === 'flip' && draft.showDate && draft.showSeconds && draft.hourFormat === '24';
  }, null, { timeout: 5000 });
  fixture.runtime.settings.clockLabel = await desktop.evaluate(() => window.controllers.clock.getState().draft.label);
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
  assert.deepEqual(fixture.service.getComponentSize('clock'), { width: 462, height: flipFrame.height });
  const outputUrl = `${fixture.origin}/clock`;
  assert.equal((await fetch(outputUrl)).status, 200);
  const output = await context.newPage();
  await output.goto(outputUrl);
  await output.waitForFunction(() => document.documentElement.style.getPropertyValue('--component-width') === '462px', null, { timeout: 5000 });
  const outputBounds = await output.locator('.clock-content').boundingBox();
  const outputInsets = [462 - outputBounds.width, flipFrame.height - outputBounds.height];
  assert.ok(outputInsets.every(value => value >= 7.8 && value <= 10), 'saved output hugs the flip frame like the editor');
});

test('legacy moon clock palettes remain editable without a default style button', { timeout: 25000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  fixture.configs.clock.style = fixture.runtime.settings.clockStyle = 'moonlit-fan';
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  t.after(async () => {
    await context.close();
    await fixture.close();
    assert.deepEqual(errors, []);
  });
  const desktop = await context.newPage();
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  desktop.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(5000);
  const url = await openCanvasDesktop(desktop, fixture, 'clock');
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.frameLocator('iframe').locator('#clockCard:not([hidden])').waitFor();
  const palettes = page.locator('[data-preview-field="clockMoonColors"]');
  assert.equal(await page.locator('[data-clock-style-option="moonlit-fan"]').count(), 0);
  const frame = page.frames().find(value => new URL(value.url()).pathname === '/clock');
  const mode = page.locator('[data-preview-field="clockMoonMode"]');
  const interval = page.locator('[data-preview-field="clockMoonIntervalSeconds"]');
  const intervalField = page.locator('[data-preview-field="clockMoonIntervalField"]');
  await frame.locator('#clockCard[data-moon-tone="light"]').waitFor();
  assert.equal(await palettes.isVisible(), true);
  assert.equal(await mode.inputValue(), 'light');
  assert.equal(await interval.inputValue(), '30');
  assert.equal(await intervalField.isVisible(), false);
  const size = await frame.evaluate(() => [innerWidth, innerHeight]);
  const moonColors = () => frame.locator('#clockCard').evaluate(card => ({
    time: getComputedStyle(card.querySelector('.clock-time')).color,
    face: getComputedStyle(card.querySelector('.clock-moon-face')).backgroundColor,
  }));
  const lightColors = await moonColors();
  await mode.selectOption('dark', { force: true });
  await frame.locator('#clockCard[data-moon-tone="dark"]').waitFor();
  const darkColors = await moonColors();
  assert.notEqual(darkColors.time, lightColors.time);
  assert.notEqual(darkColors.face, lightColors.face);
  await mode.selectOption('light', { force: true });
  await frame.locator('#clockCard[data-moon-tone="light"]').waitFor();
  await mode.selectOption('auto', { force: true });
  assert.equal(await intervalField.isVisible(), true);
  await interval.fill('2');
  await interval.press('Tab');
  await desktop.waitForFunction(() => {
    const draft = window.controllers.clock.getState().draft;
    return draft.moonMode === 'auto' && draft.moonIntervalSeconds === 2;
  });
  assert.deepEqual(await frame.evaluate(() => [innerWidth, innerHeight]), size);
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
  assert.equal(await intervalField.isVisible(), false);
  await page.locator('[data-clock-style-option="flip"]').click();
  assert.equal(await palettes.isVisible(), false);
});

test('shared canvas retains multiple layers, custom resolution and drafts, and drains every save on closure', { timeout: 45000 }, async (t) => {
  const fixture = await startComponentPreviewServer({ parentHtml: '<!doctype html><html><body></body></html>' });
  const desktopContext = await browser.newContext();
  const browserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desktop = await desktopContext.newPage();
  const page = await browserContext.newPage();
  const errors = [];
  let holdExchanges = false;
  let heldExchanges = 0;
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
    if (holdExchanges && route.request().postDataJSON().action === 'exchange') {
      if (++heldExchanges === 5) onExchangesHeld();
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
  assert.equal(await page.locator('.component-preview-add').count(), 1);
  await page.locator('[data-preview-field="clockCustomLabel"]').fill('切换后保留');
  await choose('queue');
  await page.locator('[data-overlay-style="storybook"]').click();
  await choose('clock');
  assert.equal(await page.locator('[data-preview-field="clockCustomLabel"]').inputValue(), '切换后保留');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await desktop.waitForFunction(() => window.writes.length === 2);
  assert.deepEqual(await desktop.evaluate(() => window.writes.map(write => write.id).sort()), ['canvas', 'clock']);
  assert.equal(await desktop.evaluate(() => window.controllers.queue.getState().dirty), false);
  await page.getByRole('button', { name: '锁定', exact: true }).click();
  await page.getByRole('button', { name: '解锁', exact: true }).waitFor();
  assert.equal(await page.getByRole('spinbutton', { name: '宽度', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.getByRole('button', { name: '锁定', exact: true }).waitFor();
  assert.equal(await page.getByRole('spinbutton', { name: '宽度', exact: true }).isEnabled(), true);
  await page.getByRole('spinbutton', { name: '宽度', exact: true }).fill('581');
  await page.getByRole('spinbutton', { name: '宽度', exact: true }).press('Tab');
  await page.getByRole('button', { name: '居中', exact: true }).click();
  assert.equal(await page.getByRole('spinbutton', { name: 'X', exact: true }).inputValue(), '670');
  assert.equal(await page.getByRole('spinbutton', { name: 'X', exact: true }).evaluate(input => input.checkValidity()), true);
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  const added = new Set(['clock', 'queue']);
  for (const id of ['danmaku', 'overtime', 'queue', 'clock', 'queue']) {
    await choose(id);
    added.add(id);
    assert.equal(await page.locator('iframe').count(), added.size);
    assert.equal(await page.locator('.scene-editor-parameters').count(), 1);
  }
  assert.equal(await page.locator('[data-overlay-style="storybook"]').evaluate(button => button.classList.contains('active')), true);
  assert.deepEqual(await page.locator('.scene-editor-canvas').evaluate(node => [node.offsetWidth, node.offsetHeight]), [1920, 1080]);
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
  assert.deepEqual(await page.locator('.scene-editor-canvas').evaluate(node => [node.offsetWidth, node.offsetHeight]), [1920, 1080]);
  await page.getByRole('button', { name: '画布设置', exact: true }).click();
  await page.getByRole('button', { name: '公共画布分辨率', exact: true }).click();
  await page.getByRole('option', { name: '2560 × 1440', exact: true }).click();
  for (const [name, value] of [['画布宽度', '2000'], ['画布高度', '1200']]) {
    await page.getByRole('spinbutton', { name, exact: true }).fill(value);
    if (name === '画布宽度') {
      const overtime = page.locator('.scene-editor-item[data-component="overtime"]');
      const height = await overtime.evaluate(node => node.style.height);
      const resized = await overtime.evaluate(async node => {
        window.dispatchEvent(new MessageEvent('message', {
          source: node.querySelector('iframe').contentWindow,
          origin: 'null',
          data: { type: 'component-preview:resize', size: { width: node.offsetWidth, height: node.offsetHeight + 31 } },
        }));
        await new Promise(requestAnimationFrame);
        return node.style.height;
      });
      assert.notEqual(resized, height);
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
  await page.waitForFunction(() => document.querySelector('.preview-canvas-status').textContent
    === '预览连接已结束，请从客户端重新打开预览。', null, { timeout: 5000 });
  await page.goto('about:blank');
  resumeExchanges();
  await desktop.waitForFunction(() => window.closedComponents.length === 5 && window.writes.length === 5);
  assert.deepEqual(await desktop.evaluate(() => window.writes.slice(3).map(write => write.id).sort()), ['canvas', 'clock']);
  assert.equal(await desktop.evaluate(() => window.controllers.clock.getState().saved.label), '关闭后也保存');
});
