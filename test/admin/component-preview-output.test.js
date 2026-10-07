'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');
const { randomUUID } = require('node:crypto');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

test('canvas discard restores its shared and independent edits without clearing unrelated drafts', { timeout: 20000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const created = fixture.service.create({ title: 'Discard scope', canvas: { width: 1920, height: 1080 } });
  const sharedId = randomUUID();
  const independentId = randomUUID();
  const items = [sharedId, independentId].map(id => ({ id, type: 'clock', name: id === sharedId ? 'Shared' : 'Independent',
    x: 0, y: 0, width: 320, height: 114, visible: true, locked: false,
    appearance: id === sharedId ? { mode: 'shared' } : { mode: 'independent', config: fixture.configs.clock } }));
  fixture.service.save({ id: created.document.id, expectedRevision: 1, document: { ...created.document, items } });
  const desktop = await browser.newPage();
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  desktop.setDefaultTimeout(5000);
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const receivedDrafts = Promise.all(['queue', 'clock'].map(type => page.waitForResponse(async response => {
    if (!response.url().endsWith('/api/component-preview') || response.request().postDataJSON()?.action !== 'read') return false;
    const { data } = await response.json();
    return data?.component === type && data.state.dirty;
  })));
  await desktop.evaluate(() => {
    window.controllers.queue.edit({ overlayTitle: 'Keep unrelated work' });
    window.controllers.clock.edit({ label: 'Shared draft' });
  });
  await receivedDrafts;
  await page.locator(`.preview-canvas-layer-select[data-item-id="${independentId}"]`).click();
  await page.locator('[data-preview-field="clockCustomLabel"]').fill('Local draft');
  await desktop.waitForFunction(id => window.controllers.canvas.getState().draft.document.items
    .find(item => item.id === id).appearance.config.label === 'Local draft', independentId);
  await page.locator(`.preview-canvas-layer-select[data-item-id="${sharedId}"]`).click();
  await page.getByRole('button', { name: '移除组件', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await desktop.waitForFunction(() => !window.controllers.canvas.getState().dirty && !window.controllers.clock.getState().dirty);
  assert.equal(await desktop.evaluate(() => window.controllers.queue.getState().draft.overlayTitle), 'Keep unrelated work');
  assert.equal(await desktop.evaluate(() => window.controllers.queue.getState().dirty), true);
  assert.deepEqual(await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items), items);
  await page.waitForFunction(() => [...document.querySelectorAll('button')]
    .find(button => button.textContent === '放弃修改')?.disabled);
});

for (const type of ['clock', 'queue', 'danmaku', 'overtime']) {
  test(`re-adding shared ${type} restores its saved output size`, { timeout: 20000 }, async t => {
    const fixture = await startCanvasOutputFixture();
    const browser = openBrowserSession();
    t.after(async () => { await browser.close(); await fixture.close(); });
    const created = fixture.service.create({ title: 'Retained dimensions', canvas: { width: 1920, height: 1080 } });
    const saved = fixture.service.save({ id: created.document.id, expectedRevision: 1, document: { ...created.document,
      items: [{ id: randomUUID(), type, name: type, x: 0, y: 0, width: 800, height: 400,
        visible: true, locked: false, appearance: { mode: 'shared' } }] } });
    fixture.service.publish({ id: created.document.id, expectedRevision: saved.revision });
    const removed = fixture.service.save({ id: created.document.id, expectedRevision: saved.revision,
      document: { ...saved.document, items: [] } });
    fixture.service.publish({ id: created.document.id, expectedRevision: removed.revision });
    assert.deepEqual(fixture.service.getComponentSize(type), { width: 800, height: 400 });
    const desktop = await browser.newPage();
    const page = await browser.newPage();
    const url = await openCanvasDesktop(desktop, fixture, type);
    assert.equal((await fetch(url)).status, 200);
    await page.goto(url);
    assert.equal(await page.getByRole('spinbutton', { name: '宽度', exact: true }).inputValue(), '800');
    let automaticHeight;
    if (type === 'clock') {
      await page.locator('.component-preview-frame').contentFrame().locator('#clockCard:not([hidden])').waitFor();
      await page.waitForFunction(() => !document.querySelector('.scene-editor-item-label').textContent.endsWith('800 × 400 px'));
      automaticHeight = Number(await page.getByRole('spinbutton', { name: '高度（自动）', exact: true }).inputValue());
      await page.waitForFunction(height => document.querySelector('.scene-editor-item-label').textContent.endsWith(`800 × ${height} px`), automaticHeight);
      assert.notEqual(automaticHeight, 400, 'saved width is retained while the clock aspect determines its height');
    } else if (type === 'queue') {
      const frame = await page.locator('.component-preview-frame').elementHandle().then(handle => handle.contentFrame());
      await frame.waitForFunction(() => {
        const bounds = document.querySelector('.overlay-panel').getBoundingClientRect();
        return Math.abs(innerHeight - bounds.height - 2 * bounds.top) < 1;
      });
      automaticHeight = Number(await page.getByRole('spinbutton', { name: '高度（自动）' }).inputValue());
      assert.notEqual(automaticHeight, 400, 'saved width is retained while queue content determines its height');
    } else if (type !== 'overtime') assert.equal(await page.getByRole('spinbutton', { name: '高度', exact: true }).inputValue(), '400');
    else {
      const frame = page.locator('iframe').contentFrame();
      await frame.locator('#overtimeMachine.is-content-sized').waitFor();
      const height = await frame.locator('.overtime-foreground').evaluate(node => Math.ceil(node.getBoundingClientRect().height));
      await desktop.waitForFunction(expected => window.controllers.canvas.getState().draft.document.items[0]?.height === expected, height);
    }
    await page.getByRole('button', { name: '保存并应用', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
    assert.equal(fixture.service.getComponentSize(type).width, 800);
    if (type === 'clock' || type === 'queue') assert.equal(fixture.service.getComponentSize(type).height, automaticHeight);
    else if (type !== 'overtime') assert.equal(fixture.service.getComponentSize(type).height, 400);
  });
}

test('publication ignores unloaded unused owners and follows late owner state updates without clearing real drafts', { timeout: 20000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const created = fixture.service.create({ title: 'Publication status', canvas: { width: 1920, height: 1080 } });
  fixture.service.save({ id: created.document.id, expectedRevision: 1, document: { ...created.document, items: [{
    id: randomUUID(), type: 'clock', name: 'clock', x: 0, y: 0, width: 320, height: 180, visible: true, locked: false,
    appearance: { mode: 'independent', config: fixture.configs.clock },
  }] } });
  const desktop = await browser.newPage();
  const page = await browser.newPage();
  const url = await openCanvasDesktop(desktop, fixture);
  await desktop.evaluate(() => {
    const original = window.controllers.danmaku.getState;
    // An unused owner that has not loaded must not block publication of this scene.
    window.controllers.danmaku.getState = () => ({ ...original(), loaded: false });
    window.controllers.queue.edit({ overlayTitle: 'Unrelated draft' });
  });
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const status = page.locator('.preview-canvas-status');
  await status.filter({ hasText: '有未保存修改' }).waitFor();
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await status.filter({ hasText: '本次已应用，新修改仍需保存' }).waitFor();
  assert.equal(await desktop.evaluate(() => window.controllers.queue.getState().dirty), true);
  assert.equal(fixture.service.list()[0].publishedVersion, 1);
  await desktop.evaluate(() => window.controllers.queue.discard());
  await status.filter({ hasText: '已保存并应用到直播源' }).waitFor();
  assert.equal(fixture.service.list()[0].publishedVersion, 1, 'A later owner update must not republish the scene.');
});

test('saved default components keep their real dimensions in original sources at every viewport size', { timeout: 45000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  const errors = [];
  t.after(async () => { await browser.close(); await fixture.close(); assert.deepEqual(errors, []); });
  const created = fixture.service.create({ title: 'Fixed pixels', canvas: { width: 1920, height: 1080 } });
  const document = { ...created.document, items: ['clock', 'queue', 'danmaku', 'overtime'].map(type => ({
    id: randomUUID(), type, name: type, x: 30, y: 40, width: 800, height: 400,
    visible: true, locked: false, appearance: { mode: 'shared' },
  })) };
  const saved = fixture.service.save({ id: document.id, expectedRevision: 1, document });
  fixture.service.publish({ id: document.id, expectedRevision: saved.revision });
  for (const [type, surface, content] of [
    ['clock', '.clock-stage', '#clockCard'], ['queue', 'body', '.overlay-panel'],
    ['danmaku', '#danmakuCanvasHost', '.danmaku-region'], ['overtime', '#overtimeMachine', '.overtime-foreground'],
  ]) {
    const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
    page.on('pageerror', error => errors.push(error.message));
    const source = `${fixture.origin}/${type}${type === 'danmaku' ? '?source=component' : ''}`;
    assert.equal((await fetch(source)).status, 200);
    await page.goto(source);
    await page.waitForFunction(() => document.documentElement.style.width === '800px');
    if (type === 'clock') await page.locator('#clockCard').waitFor({ state: 'visible' });
    if (type === 'queue') await page.getByText('合成实时歌曲').waitFor();
    if (type === 'danmaku') await page.waitForFunction(() => document.body.classList.contains('has-layout'));
    const bounds = async selector => page.locator(selector).evaluate(node => {
      const { width, height } = node.getBoundingClientRect(); return { width, height };
    });
    const baseline = await bounds(content);
    for (const viewport of [{ width: 800, height: 400 }, { width: 1920, height: 1080 },
      { width: 2560, height: 1440 }, { width: 3840, height: 2160 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual(await bounds(surface), { width: 800, height: 400 }, `${type}: saved surface at ${viewport.width}`);
      assert.deepEqual(await bounds(content), baseline, `${type}: content must not scale with the host viewport`);
    }
    if (type === 'clock') {
      const next = fixture.service.save({ id: document.id, expectedRevision: saved.revision,
        document: { ...document, items: document.items.map(item => item.type === 'clock' ? { ...item, width: 700 } : item) } });
      assert.equal((await bounds(surface)).width, 800, 'draft save alone does not alter output');
      fixture.service.publish({ id: document.id, expectedRevision: next.revision });
      await page.waitForFunction(() => document.documentElement.style.width === '700px');
      await page.reload();
      await page.waitForFunction(() => document.documentElement.style.width === '700px');
    }
    await page.close();
  }
});

test('canvas save updates the original default source and separate instance URLs use the same saved configuration', { timeout: 45000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  const desktop = await browser.newPage();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const output = await browser.newPage({ viewport: { width: 3840, height: 2160 } });
  const errors = [];
  for (const target of [desktop, page, output]) target.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await browser.close(); await fixture.close(); assert.deepEqual(errors, []); });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copiedSource = value; } } });
  });
  const url = await openCanvasDesktop(desktop, fixture, 'clock');
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const setSize = async width => {
    const height = page.getByRole('spinbutton', { name: '高度（自动）', exact: true });
    await page.evaluate(width => {
      window.clockResize = new Promise(resolve => {
        const receive = event => {
          const frame = document.querySelector('.scene-editor-item.is-selected iframe');
          if (event.source !== frame?.contentWindow || event.data?.type !== 'component-preview:resize'
            || event.data.size.width !== width || event.data.size.contentWidth !== width) return;
          window.removeEventListener('message', receive);
          resolve(event.data.size.height);
        };
        window.addEventListener('message', receive);
      });
    }, width);
    await page.getByRole('spinbutton', { name: '宽度', exact: true }).fill(String(width));
    await page.getByRole('spinbutton', { name: '宽度', exact: true }).press('Tab');
    const expectedHeight = await page.evaluate(() => window.clockResize);
    await page.waitForFunction(({ width, expectedHeight }) => {
      const item = document.querySelector('.scene-editor-item.is-selected');
      return item?.style.width === `${width}px` && item.style.height === `${expectedHeight}px`
        && document.querySelector('.scene-editor-geometry input[readonly]')?.value === String(expectedHeight);
    }, { width, expectedHeight });
    assert.equal(await height.evaluate(input => input.readOnly), true);
    assert.equal(Number(await height.inputValue()), expectedHeight);
    return Number(await height.inputValue());
  };
  const save = async () => {
    await page.getByRole('button', { name: '保存并应用', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
  };
  const copy = async () => {
    await page.evaluate(() => { window.copiedSource = ''; });
    await page.getByRole('button', { name: '复制单组件地址', exact: true }).click();
    await page.waitForFunction(() => window.copiedSource);
    return page.evaluate(() => window.copiedSource);
  };
  const defaultHeight = await setSize(800);
  await save();
  assert.deepEqual(fixture.service.getComponentSize('clock'), { width: 800, height: defaultHeight });
  const defaultUrl = await copy();
  assert.equal(new URL(defaultUrl).pathname, '/clock');
  assert.equal((await fetch(defaultUrl)).status, 200);
  await output.goto(defaultUrl);
  await output.waitForFunction(() => document.documentElement.style.width === '800px');
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.locator('[data-category="clock"]').click();
  await page.locator('[data-picker-style="flip"]').click();
  const independentHeight = await setSize(600);
  await save();
  const independentUrl = await copy();
  const address = new URL(independentUrl);
  assert.ok(address.searchParams.get('item'));
  assert.equal((await fetch(independentUrl)).status, 200);
  await output.goto(independentUrl);
  const frame = output.locator('.scene-version:not(.is-staging) iframe');
  await frame.waitFor();
  assert.equal(await frame.count(), 1);
  for (const viewport of [{ width: 800, height: 400 }, { width: 1920, height: 1080 },
    { width: 2560, height: 1440 }, { width: 3840, height: 2160 }]) {
    await output.setViewportSize(viewport);
    const bounds = await frame.boundingBox();
    assert.deepEqual({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      { x: 0, y: 0, width: 600, height: independentHeight });
  }
  assert.equal(await output.frameLocator('.scene-version:not(.is-staging) iframe').locator('html').getAttribute('data-clock-style'), 'flip');
  await setSize(800);
  await save();
  await output.waitForFunction(() => document.querySelector('.scene-version:not(.is-staging) iframe')?.getBoundingClientRect().width === 800);
  assert.equal(await copy(), independentUrl);
  assert.deepEqual(fixture.service.getComponentSize('clock'), { width: 800, height: defaultHeight });
  await page.goto('about:blank');
  await desktop.evaluate(() => window.reopen('clock'));
  await desktop.waitForFunction(() => window.externalPreviewUrl);
  await page.goto(await desktop.evaluate(() => window.externalPreviewUrl));
  assert.equal(await page.getByRole('spinbutton', { name: '宽度', exact: true }).inputValue(), '800');
  assert.equal(await page.getByRole('spinbutton', { name: '高度（自动）', exact: true }).inputValue(), String(defaultHeight));
});

test('empty editor adds independent styles and publishes every layer through one persistent source', { timeout: 45000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  const desktop = await browser.newPage();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const output = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  for (const target of [desktop, page, output]) target.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await browser.close(); await fixture.close(); assert.deepEqual(errors, []); });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copiedSource = value; } } });
  });
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal(new URL(url).searchParams.has('component'), false);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).waitFor();
  assert.equal(await page.locator('.scene-editor-item').count(), 0);
  assert.equal(await page.locator('.component-preview-add').count(), 1);
  assert.equal(await page.locator('.preview-canvas-resolution').textContent(), '1920 × 1080');
  assert.equal(await page.locator('.preview-canvas-sidebar').isHidden(), true);
  const assertCanvasFits = async () => {
    assert.equal(await page.locator('.scene-editor-canvas').evaluate(canvas => {
      const viewport = canvas.closest('.scene-editor-viewport');
      const bounds = canvas.getBoundingClientRect();
      const frame = viewport.getBoundingClientRect();
      const root = document.scrollingElement;
      return bounds.width > 0 && bounds.left >= frame.left && bounds.top >= frame.top
        && bounds.right <= frame.right && bounds.bottom <= frame.bottom
        && viewport.scrollWidth <= viewport.clientWidth && viewport.scrollHeight <= viewport.clientHeight
        && root.scrollWidth <= innerWidth && root.scrollHeight <= innerHeight;
    }), true, 'The entire canvas must fit without page or canvas scrolling');
  };
  await assertCanvasFits();
  assert.ok((await page.locator('.scene-editor-canvas').boundingBox()).width > 1200,
    'The initial canvas should use the space released by the side panels');
  const add = async (category, style) => {
    await page.getByRole('button', { name: '添加组件', exact: true }).click();
    await page.locator(`[data-category="${category}"]`).click();
    await page.locator(`[data-picker-style="${style}"]`).click();
  };
  await add('clock', 'peach');
  const xInput = page.getByRole('spinbutton', { name: 'X', exact: true });
  await xInput.fill('-10000');
  await page.getByRole('button', { name: '收起参数', exact: true }).click();
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  assert.equal(await page.locator('.preview-canvas-sidebar').isVisible(), true);
  assert.equal(await xInput.evaluate(input => document.activeElement === input), true);
  assert.equal(fixture.service.list()[0].publishedVersion, 0, 'Invalid hidden fields must prevent publication');
  await xInput.fill('670');
  await page.getByRole('spinbutton', { name: 'Y', exact: true }).click();
  const editingWidth = (await page.locator('.scene-editor-canvas').boundingBox()).width;
  await page.getByRole('button', { name: '收起参数', exact: true }).click();
  await page.waitForFunction(width => document.querySelector('.scene-editor-canvas').getBoundingClientRect().width > width, editingWidth);
  assert.equal(await page.locator('.scene-editor-item.is-selected').count(), 1);
  await assertCanvasFits();
  await page.getByRole('button', { name: '展开参数', exact: true }).click();
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.scene-editor-canvas').getBoundingClientRect();
    const viewport = document.querySelector('.scene-editor-viewport').getBoundingClientRect();
    return canvas.right <= viewport.right && canvas.bottom <= viewport.bottom;
  });
  await assertCanvasFits();
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await page.getByRole('spinbutton', { name: 'X', exact: true }).inputValue(), '670');
  await add('clock', 'flip');
  await add('queue', 'classic');
  await add('danmaku', 'signal');
  await add('overtime', 'default');
  assert.equal(await page.locator('iframe').count(), 5);
  await page.locator('.preview-canvas-layer-select').filter({ hasText: '萌时钟 1' }).click();
  await page.locator('[data-preview-field="clockCustomLabel"]').fill('仅第一只时钟');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
  const first = fixture.service.list()[0];
  assert.equal(first.publishedVersion, 1);
  assert.equal(first.document.items.length, 5);
  const clocks = first.document.items.filter(item => item.type === 'clock');
  assert.deepEqual(clocks.map(item => item.appearance.config.style), ['peach', 'flip']);
  assert.equal(clocks[0].appearance.config.label, '仅第一只时钟');
  assert.notEqual(clocks[1].appearance.config.label, '仅第一只时钟');
  assert.ok(first.document.items.every(item => item.appearance.mode === 'independent'));
  await page.getByRole('button', { name: '复制直播源地址', exact: true }).click();
  await page.waitForFunction(() => window.copiedSource);
  const source = await page.evaluate(() => window.copiedSource);
  const address = new URL(source);
  assert.equal(address.hostname, '127.0.0.1');
  assert.equal(address.pathname, '/scene');
  assert.equal(address.searchParams.get('id'), first.document.id);
  assert.equal((await fetch(source)).status, 200);
  await output.goto(source);
  await output.waitForFunction(() => document.querySelectorAll('.scene-version:not(.is-staging) iframe').length === 5);
  await output.frameLocator('.scene-version:not(.is-staging) iframe[title="点歌板 1"]').getByText('合成实时歌曲').waitFor();
  assert.equal(await output.frameLocator('.scene-version:not(.is-staging) iframe[title="萌时钟 2"]').locator('html').getAttribute('data-clock-style'), 'flip');
  const danmaku = output.frames().find(frame => new URL(frame.url()).pathname === '/danmaku');
  assert.equal(new URL(danmaku.url()).searchParams.get('componentLayer'), '1');
  assert.equal(await danmaku.getByText('示例观众', { exact: true }).count(), 0);
  for (const frame of output.frames().filter(frame => frame.parentFrame())) {
    assert.equal(await frame.evaluate(() => window.__API_TOKEN__), undefined);
    assert.equal(frame.url().includes(address.hash), false);
  }
  fixture.failPublication(true);
  await page.locator('[data-preview-field="clockCustomLabel"]').fill('更新后的时钟');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '模拟发布失败' }).waitFor();
  assert.equal(fixture.service.list()[0].publishedVersion, 1);
  await output.frameLocator('.scene-version:not(.is-staging) iframe[title="萌时钟 1"]').getByText('仅第一只时钟').waitFor();
  fixture.failPublication(false);
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
  await output.frameLocator('.scene-version:not(.is-staging) iframe[title="萌时钟 1"]').getByText('更新后的时钟').waitFor();
  await page.getByRole('button', { name: '复制直播源地址', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '直播源地址已复制' }).waitFor();
  assert.equal(await page.evaluate(() => window.copiedSource), source);
  await page.goto('about:blank');
  await desktop.evaluate(() => window.reopen());
  await desktop.waitForFunction(() => window.externalPreviewUrl);
  await page.goto(await desktop.evaluate(() => window.externalPreviewUrl));
  await page.waitForFunction(() => document.querySelectorAll('.scene-editor-item').length === 5);
  await page.getByRole('button', { name: '画布设置', exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: '画布设置', exact: true }).count(), 1);
  assert.equal(fixture.service.list().length, 1);
  await page.close();
  await desktop.close();
  await output.reload();
  await output.frameLocator('.scene-version:not(.is-staging) iframe[title="萌时钟 1"]').getByText('更新后的时钟').waitFor();
  fixture.runtime.queue.waiting[0].song_name = '关闭编辑器后的歌曲';
  await output.frameLocator('.scene-version:not(.is-staging) iframe[title="点歌板 1"]').getByText('关闭编辑器后的歌曲').waitFor();
  fixture.updateCloud({ type: 'danmaku', liveSessionId: 'synthetic-live', name: '合成观众', message: '关闭编辑器后的弹幕' });
  await output.frameLocator('.scene-version:not(.is-staging) iframe[title="弹幕姬 1"]').getByText('关闭编辑器后的弹幕').waitFor();
  assert.equal(await output.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await output.locator('.component-preview-body').count(), 0);
  await output.setViewportSize({ width: 1280, height: 720 });
  const size = await output.locator('.scene-version:not(.is-staging)').boundingBox();
  assert.equal(Math.round(size.width), 1920);
  assert.equal(Math.round(size.height), 1080);
});
