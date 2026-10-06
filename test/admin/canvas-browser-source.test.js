'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');

const SOURCE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; background: transparent; font: 28px system-ui; color: #173d37; }
  main { box-sizing: border-box; width: 100vw; height: 100vh; padding: 32px;
    border: 8px solid #6eae9d; border-radius: 28px; background: #e9f5ef; }
  h1 { font-size: 36px; } output { display: block; }
</style></head><body><main><h1>合成浏览器源</h1><output id="resolution"></output></main><script>
  window.receivedMessages = [];
  addEventListener('message', event => {
    if (event.data?.type?.startsWith('component-preview:')) receivedMessages.push(event.data);
  });
  const instance = new URL(location.href).searchParams.get('instance');
  function render() { document.querySelector('#resolution').textContent = instance + ' ' + innerWidth + ' × ' + innerHeight; }
  addEventListener('resize', render);
  render();
  parent.postMessage({ type: 'component-preview:ready' }, '*');
  parent.postMessage({ type: 'component-preview:resize', size: { width: 123, height: 456 } }, '*');
</script></body></html>`;

async function changeNumber(page, name, value) {
  const input = page.getByRole('spinbutton', { name, exact: true });
  await input.fill(String(value));
  await input.press('Tab');
}

async function assertSource(frame, instance, width, height) {
  await frame.locator('#resolution').filter({ hasText: `${instance} ${width} × ${height}` }).waitFor();
  assert.deepEqual(await frame.locator('body').evaluate(() => ({ width: innerWidth, height: innerHeight,
    referrer: document.referrer, messages: window.receivedMessages })),
  { width, height, referrer: '', messages: [] });
}

test('canvas browser sources keep independent viewports through editing, saving and published output', { timeout: 90000 }, async (t) => {
  const fixture = await startCanvasOutputFixture();
  const browser = await chromium.launch({ headless: true });
  const desktop = await browser.newPage();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  const sourceRequests = [];
  let publishRequests = 0;
  for (const target of [desktop, page]) target.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().endsWith('/api/component-preview') && request.postDataJSON()?.action === 'publish') publishRequests += 1;
  });
  await context.route(`${fixture.origin}/synthetic-browser-source*`, (route) => {
    sourceRequests.push(route.request().headers());
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SOURCE_HTML });
  });
  t.after(async () => {
    await browser.close();
    await fixture.close();
    assert.deepEqual(errors, []);
    assert.ok(sourceRequests.length > 0);
    assert.ok(sourceRequests.every((headers) => !headers.referer && !headers.authorization),
      'External frames receive neither a referrer nor desktop authorization.');
  });
  const screenshots = path.resolve('tmp/canvas-browser-source');
  fs.mkdirSync(screenshots, { recursive: true });
  const editorUrl = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(editorUrl)).status, 200);
  await page.goto(editorUrl);
  const open = page.getByRole('button', { name: '添加组件', exact: true });
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  await open.click();
  const heading = picker.locator('.preview-picker-heading');
  const headingBounds = await heading.boundingBox();
  assert.ok(headingBounds.height >= 34 && headingBounds.height <= 40, 'The title bar is about 2/5 of its former 90px height.');
  assert.equal(await heading.locator('p').count(), 0);
  assert.equal(await heading.getByRole('heading', { name: '添加组件', exact: true }).count(), 1);
  assert.equal(await picker.getAttribute('aria-describedby'), null);
  assert.ok(await picker.locator('.preview-picker-categories').evaluate((node) => parseFloat(getComputedStyle(node).paddingTop)) <= 8);
  const scrollbars = await picker.locator('.preview-picker-categories, .preview-picker-content').evaluateAll((nodes) => nodes.map((node) => ({
    track: getComputedStyle(node, '::-webkit-scrollbar-track').backgroundColor,
    buttons: getComputedStyle(node, '::-webkit-scrollbar-button').display,
  })));
  assert.ok(scrollbars.every(({ track, buttons }) => track === 'rgba(0, 0, 0, 0)' && buttons === 'none'));
  await page.screenshot({ path: path.join(screenshots, 'picker.png') });
  const categories = picker.locator('[data-category]');
  assert.equal(await categories.last().getAttribute('data-category'), 'browser');
  for (const category of await categories.all()) {
    await category.click();
    const categoryName = (await category.textContent()).trim();
    assert.equal(await picker.locator('.preview-picker-content').getByRole('heading', { name: categoryName, exact: true }).count(),
      0, 'Content does not repeat the category title.');
  }
  const more = picker.getByRole('button', { name: '更多', exact: true });
  assert.equal(await more.locator('svg').count(), 1);
  assert.deepEqual(await more.evaluate((node) => ({ border: getComputedStyle(node).borderTopStyle,
    rounded: parseFloat(getComputedStyle(node).borderTopLeftRadius) > 0 })), { border: 'dashed', rounded: true });
  assert.equal(await picker.locator('iframe').count(), 0, 'Opening More does not load a source before import.');
  await page.keyboard.press('Escape');
  await picker.waitFor({ state: 'hidden' });
  await open.click();
  await picker.getByRole('button', { name: '关闭', exact: true }).click();
  await picker.waitFor({ state: 'hidden' });
  await open.click();
  await more.click();
  for (const [name, value] of [['网页宽度', '800'], ['网页高度', '600']]) {
    const input = picker.getByRole('spinbutton', { name, exact: true });
    assert.equal(await input.inputValue(), value);
    assert.equal(await input.getAttribute('min'), '32');
    assert.equal(await input.getAttribute('max'), '7680');
  }
  await picker.getByRole('textbox', { name: '组件名称', exact: true }).fill('天气组件');
  const sourceUrl = picker.getByRole('textbox', { name: '浏览器源地址', exact: true });
  await sourceUrl.fill('javascript:alert(1)');
  await picker.getByRole('button', { name: '添加到画布', exact: true }).click();
  await picker.locator('[role="alert"]:visible').waitFor();
  assert.ok((await picker.locator('[role="alert"]:visible').textContent()).trim());
  assert.equal(await page.locator('.scene-editor-item').count(), 0);
  const firstUrl = `${fixture.origin}/synthetic-browser-source?instance=first&token=synthetic-provider-secret`;
  await sourceUrl.fill(firstUrl);
  await page.screenshot({ path: path.join(screenshots, 'import.png') });
  await picker.getByRole('button', { name: '添加到画布', exact: true }).click();
  await picker.waitFor({ state: 'hidden' });
  const first = page.locator('.scene-editor-item[data-component="browser"]').first();
  const firstId = await first.getAttribute('data-item-id');
  await assertSource(first.frameLocator('iframe'), 'first', 800, 600);
  assert.equal(await first.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await first.locator('iframe').getAttribute('referrerpolicy'), 'no-referrer');
  assert.equal(await page.getByRole('textbox', { name: '组件名称', exact: true }).inputValue(), '天气组件');
  assert.equal(await page.locator('[data-component-parameter]').count(), 0);
  const geometry = () => first.evaluate((node) => ['left', 'top', 'width', 'height'].map((key) => parseFloat(node.style[key])));
  const before = await geometry();
  const start = await first.boundingBox();
  await page.mouse.move(start.x + 40, start.y + 40);
  await page.mouse.down();
  await page.mouse.move(start.x + 72, start.y + 56, { steps: 5 });
  await page.mouse.up();
  const moved = await geometry();
  assert.notDeepEqual(moved.slice(0, 2), before.slice(0, 2));
  const handle = await first.locator('[data-resize="se"]').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 32, handle.y + handle.height / 2 + 16, { steps: 5 });
  await page.mouse.up();
  const resized = await geometry();
  assert.ok(resized[2] > moved[2] && resized[3] > moved[3]);
  assert.ok((await first.locator('.scene-editor-item-label').textContent()).includes(`${resized[2]} × ${resized[3]} px`));
  await assertSource(first.frameLocator('iframe'), 'first', 800, 600);
  await changeNumber(page, '宽度', 400);
  await changeNumber(page, '高度', 300);

  await open.click();
  await more.click();
  assert.equal(await sourceUrl.inputValue(), '');
  assert.equal(await picker.getByRole('textbox', { name: '组件名称', exact: true }).inputValue(), '浏览器源');
  await picker.getByRole('textbox', { name: '组件名称', exact: true }).fill('活动组件');
  const secondUrl = `${fixture.origin}/synthetic-browser-source?instance=second`;
  await sourceUrl.fill(secondUrl);
  await changeNumber(picker, '网页宽度', 640);
  await changeNumber(picker, '网页高度', 360);
  await picker.getByRole('button', { name: '添加到画布', exact: true }).click();
  const second = page.locator('.scene-editor-item[data-component="browser"]').nth(1);
  await assertSource(second.frameLocator('iframe'), 'second', 640, 360);
  await open.click();
  await more.click();
  assert.equal(await picker.getByRole('spinbutton', { name: '网页宽度', exact: true }).inputValue(), '800');
  assert.equal(await picker.getByRole('spinbutton', { name: '网页高度', exact: true }).inputValue(), '600');
  await page.keyboard.press('Escape');
  await page.locator(`.preview-canvas-layer[data-item-id="${firstId}"] .preview-canvas-layer-select`).click();
  const editedUrl = firstUrl.replace('instance=first', 'instance=updated');
  const inspectorUrl = page.getByRole('textbox', { name: '浏览器源地址', exact: true });
  await inspectorUrl.fill('javascript:alert(2)');
  await inspectorUrl.press('Tab');
  await page.locator('.scene-editor-parameters [role="alert"]:visible').waitFor();
  assert.equal(await inspectorUrl.evaluate((input) => input.checkValidity()), false);
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.waitForResponse((response) => response.url().endsWith('/api/component-preview')
    && response.request().postDataJSON()?.action === 'read');
  assert.equal(publishRequests, 0, 'An invalid inspector URL blocks publication instead of saving stale configuration.');
  await assertSource(first.frameLocator('iframe'), 'first', 800, 600);
  await changeNumber(page, '网页宽度', 960);
  await inspectorUrl.fill(editedUrl);
  await inspectorUrl.press('Tab');
  assert.equal(await page.getByRole('spinbutton', { name: '网页宽度', exact: true }).evaluate((input) => input.checkValidity()), true,
    'Fixing the URL also clears a validation error on a viewport field edited while the URL was invalid.');
  await changeNumber(page, '网页高度', 540);
  await assertSource(first.frameLocator('iframe'), 'updated', 960, 540);
  await assertSource(second.frameLocator('iframe'), 'second', 640, 360);
  assert.deepEqual((await geometry()).slice(2), [400, 300], 'Viewport edits preserve the display rectangle.');
  await page.screenshot({ path: path.join(screenshots, 'editor.png') });
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.preview-canvas-status').textContent.includes('已保存并应用'));
  const saved = fixture.service.list()[0];
  assert.deepEqual(saved.document.items.map((item) => ({ type: item.type, name: item.name, width: item.width,
    height: item.height, appearance: item.appearance })), [
    { type: 'browser', name: '天气组件', width: 400, height: 300,
      appearance: { mode: 'independent', config: { url: editedUrl, viewportWidth: 960, viewportHeight: 540 } } },
    { type: 'browser', name: '活动组件', width: 640, height: 360,
      appearance: { mode: 'independent', config: { url: secondUrl, viewportWidth: 640, viewportHeight: 360 } } },
  ]);
  await page.reload();
  await assertSource(first.frameLocator('iframe'), 'updated', 960, 540);
  await assertSource(second.frameLocator('iframe'), 'second', 640, 360);
  assert.deepEqual((await geometry()).slice(2), [400, 300]);

  const source = fixture.service.getSource(saved.document.id);
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  const output = await context.newPage();
  output.on('pageerror', (error) => errors.push(error.message));
  await output.goto(outputUrl);
  await output.locator('.scene-version:not(.is-staging)').waitFor();
  const frames = output.locator('.scene-version:not(.is-staging) iframe');
  assert.equal(await frames.count(), 2);
  await assertSource(output.frameLocator('iframe').nth(0), 'updated', 960, 540);
  await assertSource(output.frameLocator('iframe').nth(1), 'second', 640, 360);
  assert.deepEqual(await frames.evaluateAll((nodes) => nodes.map((node) => ({
    sandbox: node.getAttribute('sandbox'), referrer: node.getAttribute('referrerpolicy'),
    width: Math.round(node.getBoundingClientRect().width), height: Math.round(node.getBoundingClientRect().height),
  }))), [
    { sandbox: 'allow-scripts', referrer: 'no-referrer', width: 400, height: 300 },
    { sandbox: 'allow-scripts', referrer: 'no-referrer', width: 640, height: 360 },
  ]);
  const single = await context.newPage();
  single.on('pageerror', (error) => errors.push(error.message));
  const singleUrl = `${fixture.origin}/scene?id=${source.id}&item=${firstId}#token=${source.token}`;
  assert.equal((await fetch(singleUrl)).status, 200);
  await single.goto(singleUrl);
  await single.locator('.scene-version:not(.is-staging)').waitFor();
  assert.equal(await single.locator('iframe').count(), 1);
  await assertSource(single.frameLocator('iframe'), 'updated', 960, 540);
  assert.deepEqual(await single.locator('iframe').evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return [node.style.left, node.style.top, Math.round(bounds.width), Math.round(bounds.height)];
  }), ['0px', '0px', 400, 300]);
  await single.screenshot({ path: path.join(screenshots, 'single-output.png') });

  const outputFrames = output.frames().filter((frame) => frame.parentFrame());
  const singleFrame = single.frames().find((frame) => frame.parentFrame());
  for (const frame of [...outputFrames, singleFrame]) {
    await frame.evaluate(() => { window.connectionMarker = 'keep this document alive'; });
  }
  let outputNavigations = 0;
  for (const target of [output, single]) target.on('request', (request) => {
    if (new URL(request.url()).pathname === '/synthetic-browser-source') outputNavigations += 1;
  });
  const changed = structuredClone(saved.document);
  changed.canvas = { width: 1600, height: 900 };
  Object.assign(changed.items[0], { name: '天气位置调整', x: 32, y: 48, width: 600, height: 400 });
  Object.assign(changed.items[0].appearance.config, { viewportWidth: 1200, viewportHeight: 800 });
  changed.items.reverse();
  const updated = fixture.service.save({ id: source.id, expectedRevision: saved.revision, document: changed });
  fixture.service.publish({ id: source.id, expectedRevision: updated.revision });
  await output.waitForFunction(() => document.querySelector('iframe[title="天气位置调整"]')?.style.left === '32px');
  await single.waitForFunction(() => document.querySelector('iframe')?.getBoundingClientRect().width === 600);
  assert.ok(outputFrames.every((frame) => !frame.isDetached()), 'Combined output preserves its existing frames.');
  assert.ok(!singleFrame.isDetached(), 'Single output preserves its existing frame.');
  await assertSource(output.frameLocator('iframe[title="天气位置调整"]'), 'updated', 1200, 800);
  await assertSource(single.frameLocator('iframe'), 'updated', 1200, 800);
  for (const frame of [...outputFrames, singleFrame]) {
    assert.equal(await frame.evaluate(() => window.connectionMarker), 'keep this document alive');
  }
  assert.equal(outputNavigations, 0, 'Layout, layer order and viewport edits do not reconnect browser sources.');
  assert.deepEqual(await frames.evaluateAll((nodes) => nodes.map((node) => [node.title, node.style.zIndex])),
    [['天气位置调整', '1'], ['活动组件', '0']]);
});
