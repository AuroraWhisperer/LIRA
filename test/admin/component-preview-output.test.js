'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { randomUUID } = require('node:crypto');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

test('ranking output adapts row count to frame height and keeps the current room in nearby mode', { timeout: 15000 }, async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: '<!doctype html><body></body>' });
  const browser = openBrowserSession();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await browser.close(); await fixture.close(); assert.deepEqual(errors, []); });
  assert.equal((await fetch(`${fixture.origin}/preview-test-host`)).status, 200);
  assert.equal((await fetch(`${fixture.origin}/live-rankings?componentPreview=1&sceneComponent=1`)).status, 200);
  await page.goto(`${fixture.origin}/preview-test-host`);
  await page.evaluate(async () => {
    const { rankingDefaults } = await import('/js/shared/live-rankings.js');
    let config = { ...rankingDefaults(), range: 'all', pageSeconds: 30 };
    const rows = Array.from({ length: 50 }, (_, index) => ({ rank: index + 1, roomId: String(index + 1), name: `主播 ${index + 1}`, score: 10000 - index }));
    const data = { room: { roomId: '25' }, boards: [{ id: 'hot', title: '热门全站', unit: '热度值', limit: 100,
      status: 'ready', rows, current: { ...rows[24], distance: 1 }, endsAt: Date.now() + 600000, updatedAt: Date.now() }] };
    const iframe = document.createElement('iframe');
    iframe.id = 'rankingFrame'; iframe.style.width = '540px'; iframe.style.height = '420px';
    iframe.setAttribute('sandbox', 'allow-scripts');
    window.updateRankingConfig = change => {
      config = { ...config, ...change };
      iframe.contentWindow.postMessage({ type: 'component-preview:config', config }, '*');
    };
    window.addEventListener('message', event => {
      if (event.source !== iframe.contentWindow || event.data?.type !== 'component-preview:ready') return;
      iframe.contentWindow.postMessage({ type: 'component-preview:init', config }, '*');
      iframe.contentWindow.postMessage({ type: 'component-preview:data', data }, '*');
    });
    iframe.src = '/live-rankings?componentPreview=1&sceneComponent=1';
    document.body.append(iframe);
  });
  await page.frameLocator('#rankingFrame').locator('.ranking-list .ranking-row').first().waitFor();
  const frame = page.frames().find(child => new URL(child.url()).pathname === '/live-rankings');
  const count = () => frame.locator('.ranking-list .ranking-row').count();
  async function assertRowsFit() {
    assert.equal(await frame.locator('.ranking-body').evaluate(body => {
      const last = body.querySelector('.ranking-list .ranking-row:last-child');
      return last && last.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom - parseFloat(getComputedStyle(body).paddingBottom) + 1;
    }), true);
  }
  const initial = await count();
  await page.locator('#rankingFrame').evaluate(iframe => { iframe.style.height = '800px'; });
  await frame.waitForFunction(previous => document.querySelector('.ranking-list').children.length > previous, initial);
  const tall = await count();
  await assertRowsFit();
  await page.locator('#rankingFrame').evaluate(iframe => { iframe.style.height = '300px'; });
  await frame.waitForFunction(previous => document.querySelector('.ranking-list').children.length < previous, initial);
  await assertRowsFit();
  await page.evaluate(() => window.updateRankingConfig({ range: 'nearby' }));
  await frame.locator('.ranking-list .is-current').waitFor();
  const nearby = await count();
  await page.locator('#rankingFrame').evaluate(iframe => { iframe.style.height = '800px'; });
  await frame.waitForFunction(previous => document.querySelector('.ranking-list').children.length > previous, nearby);
  assert.equal(await frame.locator('.ranking-list .is-current').count(), 1);
  await assertRowsFit();
  await page.evaluate(() => window.updateRankingConfig({ range: 'all', fontSize: 30 }));
  await frame.waitForFunction(previous => document.querySelector('.ranking-list').children.length < previous, tall);
  await assertRowsFit();
});

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
  await page.locator(`.preview-canvas-layer-select[data-item-id="${sharedId}"]`).click();
  await desktop.evaluate(() => {
    window.controllers.queue.edit({ overlayTitle: 'Keep unrelated work' });
    window.controllers.clock.edit({ label: 'Shared draft' });
  });
  await page.waitForFunction(() => document.querySelector('[data-preview-field="clockCustomLabel"]')?.value === 'Shared draft');
  await page.locator(`.preview-canvas-layer-select[data-item-id="${independentId}"]`).click();
  await page.locator('[data-preview-field="clockCustomLabel"]').fill('Local draft');
  await desktop.waitForFunction(() => window.controllers.clock.getState().draft.label === 'Local draft');
  assert.notEqual(await desktop.evaluate(id => window.controllers.canvas.getState().draft.document.items
    .find(item => item.id === id).appearance.config.label, independentId), 'Local draft');
  await page.locator(`.preview-canvas-layer-select[data-item-id="${sharedId}"]`).click();
  await page.getByRole('button', { name: '移除组件', exact: true }).click();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 1);
  const edited = await desktop.evaluate(() => window.controllers.canvas.getState().draft.document);
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '放弃未保存的修改？', exact: true });
  await confirmation.waitFor();
  assert.deepEqual(await desktop.evaluate(() => window.controllers.canvas.getState().draft.document), edited);
  await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
  await confirmation.waitFor({ state: 'detached' });
  assert.deepEqual(await desktop.evaluate(() => window.controllers.canvas.getState().draft.document), edited);
  assert.equal(await desktop.evaluate(() => window.controllers.clock.getState().draft.label), 'Local draft');
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await confirmation.getByRole('button', { name: '放弃修改', exact: true }).click();
  await confirmation.waitFor({ state: 'detached' });
  await desktop.waitForFunction(() => !window.controllers.canvas.getState().dirty && !window.controllers.clock.getState().dirty);
  assert.equal(await desktop.evaluate(() => window.controllers.queue.getState().draft.overlayTitle), 'Keep unrelated work');
  assert.equal(await desktop.evaluate(() => window.controllers.queue.getState().dirty), true);
  assert.deepEqual(await desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items), items);
});

test('the shared song-board provider saves parameters automatically without publishing', { timeout: 20000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  fixture.runtime.settings.songBoardSyncTheme = 'false';
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const created = fixture.service.create({ title: 'Automatic parameters', canvas: { width: 1920, height: 1080 } });
  const item = { id: randomUUID(), type: 'songlist', name: '展示板', x: 0, y: 0, width: 640, height: 500,
    visible: true, locked: false, appearance: { mode: 'independent', config: {} } };
  fixture.service.save({ id: created.document.id, expectedRevision: 1, document: { ...created.document, items: [item] } });
  const desktop = await browser.newPage();
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.locator(`.preview-canvas-layer-select[data-item-id="${item.id}"]`).click();
  const savedParameters = page.waitForResponse(async response => response.url().includes('/api/component-preview/appearance')
    && response.request().postDataJSON()?.action === 'patch' && response.ok());
  await page.locator('[data-component-parameter="songBoardTitle"]').fill('自动保存标题');
  await page.locator('[data-component-parameter="songBoardTitle"]').press('Tab');
  await savedParameters;
  assert.equal(fixture.runtime.settings.songBoardTitle, '自动保存标题');
  assert.equal(fixture.service.list()[0].publishedVersion, 0);
});

for (const type of ['clock', 'queue', 'danmaku']) {
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
      await page.waitForFunction(() => document.querySelector('.scene-editor-geometry input[readonly]')?.value !== '400');
      automaticHeight = Number(await page.getByRole('spinbutton', { name: '高度（自动）', exact: true }).inputValue());
      assert.notEqual(automaticHeight, 400, 'saved width is retained while the clock aspect determines its height');
    } else if (type === 'queue') {
      const frame = await page.locator('.component-preview-frame').elementHandle().then(handle => handle.contentFrame());
      await frame.waitForFunction(() => {
        const bounds = document.querySelector('.overlay-panel').getBoundingClientRect();
        return Math.abs(innerHeight - bounds.height - 2 * bounds.top) < 1;
      });
      automaticHeight = Number(await page.getByRole('spinbutton', { name: '高度（自动）' }).inputValue());
      assert.notEqual(automaticHeight, 400, 'saved width is retained while queue content determines its height');
    } else assert.equal(await page.getByRole('spinbutton', { name: '高度', exact: true }).inputValue(), '400');
    await page.getByRole('button', { name: '保存并应用', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
    assert.equal(fixture.service.getComponentSize(type).width, 800);
    assert.equal(fixture.service.getComponentSize(type).height, type === 'danmaku' ? 400 : automaticHeight);
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
  await status.filter({ hasText: '未保存' }).waitFor();
  // The clock's initial content measurement is an edit, so finish it before publishing.
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[0].height !== 180);
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
    for (const viewport of [{ width: 800, height: 400 }, { width: 3840, height: 2160 }]) {
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
    assert.equal(Number(await height.inputValue()), expectedHeight);
    return Number(await height.inputValue());
  };
  const save = async () => {
    await page.getByRole('button', { name: '保存并应用', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
  };
  const copy = async () => {
    await page.evaluate(() => { window.copiedSource = ''; });
    await page.getByRole('button', { name: '复制组件地址', exact: true }).click();
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
  for (const viewport of [{ width: 800, height: 400 }, { width: 3840, height: 2160 }]) {
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
  await page.locator('.preview-canvas-sidebar').waitFor();
  assert.equal(fixture.service.list()[0].publishedVersion, 0, 'Invalid hidden fields must prevent publication');
  await xInput.fill('670');
  await page.getByRole('spinbutton', { name: 'Y', exact: true }).click();
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
  const { appearances } = await fixture.service.getOutput(fixture.service.getSource(first.document.id));
  assert.equal(appearances[clocks[0].id].label, '仅第一只时钟');
  assert.notEqual(appearances[clocks[1].id].label, '仅第一只时钟');
  assert.ok(first.document.items.every(item => item.appearance.mode === 'independent'));
  await page.getByRole('button', { name: '复制场景地址', exact: true }).click();
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
  await page.locator('.preview-canvas-status').filter({ hasText: '模拟发布失败' }).waitFor();
  assert.equal(fixture.service.list()[0].publishedVersion, 1);
  await output.frameLocator('.scene-version:not(.is-staging) iframe[title="萌时钟 1"]').getByText('更新后的时钟').waitFor();
  fixture.failPublication(false);
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
  await output.frameLocator('.scene-version:not(.is-staging) iframe[title="萌时钟 1"]').getByText('更新后的时钟').waitFor();
  await page.evaluate(() => { window.copiedSource = ''; });
  await page.getByRole('button', { name: '复制场景地址', exact: true }).click();
  await page.waitForFunction(() => window.copiedSource);
  assert.equal(await page.evaluate(() => window.copiedSource), source);
  await page.goto('about:blank');
  await desktop.evaluate(() => window.reopen());
  await desktop.waitForFunction(() => window.externalPreviewUrl);
  await page.goto(await desktop.evaluate(() => window.externalPreviewUrl));
  await page.waitForFunction(() => document.querySelectorAll('.scene-editor-item').length === 5);
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
  await output.setViewportSize({ width: 1280, height: 720 });
  const size = await output.locator('.scene-version:not(.is-staging)').boundingBox();
  assert.equal(Math.round(size.width), 1920);
  assert.equal(Math.round(size.height), 1080);
});
