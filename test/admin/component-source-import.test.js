'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

async function setup(t) {
  const root = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(root, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(root, 'component-source-browser-'));
  let fixture;
  let browser;
  t.after(async () => {
    try { await browser?.close(); } finally {
      try { await fixture?.close(); } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
    }
  });
  fixture = await startCanvasOutputFixture({ dataDir });
  browser = openBrowserSession();
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  context.on('page', page => {
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
  });
  const desktop = await context.newPage();
  const editorUrl = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(editorUrl)).status, 200);
  const page = await context.newPage();
  await page.goto(editorUrl);
  async function listStyles() {
    const response = await fetch(`${fixture.origin}/api/component-styles/list`, {
      headers: { Authorization: `Bearer ${fixture.token}` },
    });
    const result = await response.json();
    assert.equal(response.status, 200, result.error);
    return result.data.flatMap(pack => pack.styles);
  }
  const readItems = () => desktop.evaluate(() => window.controllers.canvas.getState().draft.document.items);
  return { dataDir, fixture, context, desktop, page, errors, listStyles, readItems };
}

async function openImport(page, type) {
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  await picker.locator(`[data-category="${type}"]`).click();
  await picker.getByRole('button', { name: '添加样式', exact: true }).click();
  return { picker, dialog: page.getByRole('dialog', { name: '添加第三方样式', exact: true }) };
}

async function saveStyle(dialog, name) {
  await dialog.getByLabel('样式名称', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: '添加样式', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
}

async function publish(page) {
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
}

async function openOutput(context, fixture) {
  const saved = fixture.service.list()[0];
  const source = fixture.service.getSource(saved.document.id);
  const url = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(url)).status, 200);
  const output = await context.newPage();
  await output.goto(url);
  await output.locator('.scene-version:not(.is-staging)').waitFor();
  return output;
}

async function changeNumber(page, name, value) {
  const input = page.getByRole('spinbutton', { name, exact: true });
  await input.fill(String(value));
  await input.press('Tab');
}

test('file CSS and bundled HTML import, replace in place and survive publication and reload', { timeout: 60000 }, async t => {
  const { dataDir, fixture, context, desktop, page, errors, listStyles, readItems } = await setup(t);
  const { picker, dialog } = await openImport(page, 'clock');
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: '选择 CSS 文件', exact: true }).click();
  await (await chooser).setFiles({ name: 'clock.css', mimeType: 'text/css',
    buffer: Buffer.from('.clock-time { color: rgb(17, 68, 119) !important; }') });
  assert.equal(await dialog.locator('select').inputValue(), 'clock.css');
  await saveStyle(dialog, '合成 CSS 时钟');
  const native = (await listStyles())[0];
  assert.equal(native.type, 'clock');
  assert.equal(native.config.cssStyle.engine, 'native');
  await picker.getByRole('button', { name: '添加到画布：合成 CSS 时钟', exact: true }).click();
  const clock = page.frameLocator('.scene-editor-item iframe');
  await clock.locator('.clock-time').waitFor();
  assert.equal(await clock.locator('.clock-time').evaluate(node => getComputedStyle(node).color), 'rgb(17, 68, 119)');
  await changeNumber(page, 'X', 96);
  await changeNumber(page, 'Y', 72);
  await desktop.waitForFunction(() => {
    const item = window.controllers.canvas.getState().draft.document.items[0];
    return item?.x === 96 && item.y === 72;
  });
  await publish(page);
  const output = await openOutput(context, fixture);
  const live = output.frameLocator('.scene-version:not(.is-staging) iframe');
  await live.locator('.clock-time').waitFor();
  assert.equal(await live.locator('.clock-time').evaluate(node => getComputedStyle(node).color), 'rgb(17, 68, 119)');
  const original = (await readItems())[0];

  const sourceDir = path.join(dataDir, 'source-bundle');
  const entries = {
    'widgets/index.html': '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="../css/theme.css"><main><h1 id="clock">loading</h1><img id="frame" src="../images/frame%20one.webp"></main><script>window.inlineBoots = (window.inlineBoots || 0) + 1;</script><script type="module" src="../js/main.mjs"></script>',
    'css/theme.css': '@import "palette.css"; body { margin: 0; } #clock { color: var(--clock-color); } main { background-image: url("../images/frame%20one.webp"); }',
    'css/palette.css': ':root { --clock-color: rgb(12, 98, 76); }',
    'js/main.mjs': 'import { label } from "./label.mjs"; const data = await (await fetch(new URL("./clock.json", import.meta.url))).json(); document.querySelector("#clock").textContent = `${label} ${data.time}`; window.moduleBoots = (window.moduleBoots || 0) + 1;',
    'js/label.mjs': 'export const label = "配套时钟";',
    'js/clock.json': '{"time":"12:34:56"}',
    'images/frame one.webp': fs.readFileSync(path.resolve(__dirname, '../../public/img/component-previews/clock-moonlit-fan.webp')),
  };
  for (const [name, content] of Object.entries(entries)) {
    const filename = path.join(sourceDir, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  }
  await page.getByRole('button', { name: '更换样式 / 添加素材', exact: true }).click();
  const library = page.getByRole('dialog', { name: '时钟底图样式', exact: true });
  await library.locator('.component-style-add').click();
  await dialog.locator('input[webkitdirectory]').setInputFiles(sourceDir);
  assert.equal(await dialog.locator('select').inputValue(), 'widgets/index.html');
  await changeNumber(dialog, '网页宽度', 640);
  await changeNumber(dialog, '网页高度', 360);
  await saveStyle(dialog, '合成 HTML 时钟');
  const imported = (await listStyles()).find(style => style.name === '合成 HTML 时钟');
  assert.equal(imported.type, 'browser');
  assert.equal(imported.category, 'clock');
  assert.match(imported.config.url, /\/widgets\/index\.html$/);
  assert.equal(await library.locator('iframe').count(), 0, 'Library cards do not execute third-party HTML.');
  await library.getByRole('button', { name: '更换「合成 CSS 时钟」的样式：合成 HTML 时钟', exact: true }).click();
  await clock.locator('#clock').filter({ hasText: '配套时钟 12:34:56' }).waitFor();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[0].type === 'browser');
  const replaced = (await readItems())[0];
  for (const key of ['id', 'name', 'x', 'y', 'width', 'height', 'locked', 'visible']) assert.deepEqual(replaced[key], original[key], key);
  assert.equal(replaced.type, 'browser');
  assert.equal(await page.locator('.scene-editor-item').count(), 1);
  assert.equal(await page.locator('.scene-editor-item iframe').getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await live.locator('.clock-time').count(), 1, 'Replacement remains a draft until publication.');
  await publish(page);
  await live.locator('#clock').filter({ hasText: '配套时钟 12:34:56' }).waitFor();
  fs.rmSync(sourceDir, { recursive: true, force: true });
  await page.reload();
  await output.reload();
  for (const frame of [clock, live]) {
    await frame.locator('#clock').filter({ hasText: '配套时钟 12:34:56' }).waitFor();
    assert.deepEqual(await frame.locator('body').evaluate(() => ({
      color: getComputedStyle(document.querySelector('#clock')).color,
      image: document.querySelector('#frame').complete && document.querySelector('#frame').naturalWidth > 0,
      background: getComputedStyle(document.querySelector('main')).backgroundImage,
      inlineBoots: window.inlineBoots, moduleBoots: window.moduleBoots,
      width: innerWidth, height: innerHeight,
    })), { color: 'rgb(12, 98, 76)', image: true,
      background: `url("${fixture.origin}${imported.config.url.replace('/widgets/index.html', '/images/frame%20one.webp')}")`,
      inlineBoots: 1, moduleBoots: 1, width: 640, height: 360 });
  }
  const liveFrame = output.frames().find(frame => frame.url().includes('/component-web/'));
  await liveFrame.evaluate(() => { window.retainedDocument = true; });
  let navigations = 0;
  output.on('request', request => { if (request.isNavigationRequest() && request.url().includes('/component-web/')) navigations += 1; });
  await page.locator(`.preview-canvas-layer[data-item-id="${original.id}"] .preview-canvas-layer-select`).click();
  await changeNumber(page, 'X', 128);
  await publish(page);
  await output.waitForFunction(() => document.querySelector('.scene-version:not(.is-staging) iframe')?.style.left === '128px');
  assert.equal(await liveFrame.evaluate(() => window.retainedDocument), true);
  assert.equal(navigations, 0, 'Moving an imported HTML component does not reconnect it.');
  assert.equal(await output.locator('.scene-version:not(.is-staging) iframe').count(), 1);

  const replacementImport = await openImport(page, 'clock');
  await replacementImport.dialog.locator('input[type="file"]:not([webkitdirectory])').setInputFiles({
    name: 'replacement.html', mimeType: 'text/html',
    buffer: Buffer.from('<!doctype html><h1 id="replacement"></h1><script>document.querySelector("#replacement").textContent = "第二套 HTML 时钟";</script>'),
  });
  await saveStyle(replacementImport.dialog, '第二套 HTML 时钟');
  await replacementImport.picker.getByRole('button', { name: '添加到画布：第二套 HTML 时钟', exact: true }).waitFor();
  await replacementImport.picker.getByRole('button', { name: '关闭', exact: true }).click();
  const beforeSecondReplacement = (await readItems())[0];
  await page.getByRole('button', { name: '更换样式', exact: true }).click();
  const browserLibrary = page.getByRole('dialog', { name: '浏览器源样式', exact: true });
  await browserLibrary.getByRole('button', { name: '更换「合成 CSS 时钟」的样式：合成 HTML 时钟', exact: true }).waitFor();
  await browserLibrary.getByRole('button', { name: '更换「合成 CSS 时钟」的样式：第二套 HTML 时钟', exact: true }).click();
  await clock.getByText('第二套 HTML 时钟', { exact: true }).waitFor();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[0].appearance.config.url.endsWith('/replacement.html'));
  const secondReplacement = (await readItems())[0];
  for (const key of ['id', 'type', 'name', 'x', 'y', 'width', 'height', 'locked', 'visible']) assert.deepEqual(secondReplacement[key], beforeSecondReplacement[key], key);
  await publish(page);
  await live.getByText('第二套 HTML 时钟', { exact: true }).waitFor();
  assert.equal(navigations, 1, 'Replacing the HTML source navigates the output exactly once.');
  assert.equal(await page.locator('.scene-editor-item iframe').count(), 1);
  assert.equal(await output.locator('.scene-version:not(.is-staging) iframe').count(), 1);
  assert.deepEqual(errors, []);
});

test('pasted blivechat and selected BLC CSS style real scene danmaku after reload', { timeout: 60000 }, async t => {
  const { dataDir, fixture, context, page, errors, listStyles } = await setup(t);
  const resources = path.join(dataDir, 'css-resources');
  fs.mkdirSync(path.join(resources, 'images'), { recursive: true });
  fs.copyFileSync(path.resolve(__dirname, '../../public/img/component-previews/clock-moonlit-fan.webp'), path.join(resources, 'images/frame.webp'));
  const pasted = await openImport(page, 'danmaku');
  await pasted.dialog.getByRole('button', { name: '粘贴 CSS', exact: true }).click();
  await pasted.dialog.getByLabel('CSS 代码', { exact: true }).fill('yt-live-chat-text-message-renderer { background-image: url("images/frame.webp"); } yt-live-chat-text-message-renderer #message { color: rgb(140, 26, 91) !important; }');
  await pasted.dialog.locator('input[webkitdirectory]').setInputFiles(resources);
  await saveStyle(pasted.dialog, '合成 blivechat 弹幕');
  await pasted.picker.getByRole('button', { name: '添加到画布：合成 blivechat 弹幕', exact: true }).click();
  const selected = await openImport(page, 'danmaku');
  await selected.dialog.locator('input[type="file"]:not([webkitdirectory])').setInputFiles({
    name: 'chat.css', mimeType: 'text/css', buffer: Buffer.from('.danmaku-message { color: rgb(19, 99, 155) !important; }'),
  });
  await saveStyle(selected.dialog, '合成 BLC 弹幕');
  await selected.picker.getByRole('button', { name: '添加到画布：合成 BLC 弹幕', exact: true }).click();
  assert.deepEqual((await listStyles()).map(style => style.config.cssStyle.engine).sort(), ['blc', 'blivechat']);
  assert.equal(await page.locator('.scene-editor-item').count(), 2);
  await publish(page);
  const saved = fixture.service.list()[0];
  assert.deepEqual(saved.document.items.map(item => item.appearance.config.cssStyle.engine), ['blivechat', 'blc']);
  fs.rmSync(resources, { recursive: true, force: true });
  await page.reload();
  const output = await openOutput(context, fixture);
  const blivechat = output.frameLocator('.scene-version:not(.is-staging) iframe[title="合成 blivechat 弹幕"]');
  const blc = output.frameLocator('.scene-version:not(.is-staging) iframe[title="合成 BLC 弹幕"]');
  for (const frame of [blivechat, blc]) {
    await frame.getByText('合成开播确认', { exact: true }).waitFor();
    assert.equal(await frame.getByText('晚上好，今天也来听歌啦！', { exact: true }).count(), 0, 'Published sources do not show preview samples.');
  }
  fixture.updateCloud({ type: 'danmaku', liveSessionId: 'synthetic-live', name: '实时观众', message: '样式已收到实时弹幕', guardLevel: 3 });
  for (const [frame, selector, color] of [[blivechat, '#message', 'rgb(140, 26, 91)'], [blc, '.danmaku-message', 'rgb(19, 99, 155)']]) {
    const message = frame.locator(selector).filter({ hasText: '样式已收到实时弹幕' });
    await message.waitFor();
    assert.equal(await message.count(), 1, 'Each cloud message is rendered once.');
    assert.equal(await message.evaluate(node => getComputedStyle(node).color), color);
    assert.equal(await frame.getByText('实时观众', { exact: true }).count(), 1);
    assert.equal(await frame.locator('link[data-component-css]').count(), 1, 'A single imported stylesheet is attached.');
  }
  await output.reload();
  for (const frame of [blivechat, blc]) await frame.getByText('合成开播确认', { exact: true }).waitFor();
  const companion = await blivechat.locator('yt-live-chat-text-message-renderer').first().evaluate(async node => {
    const source = getComputedStyle(node).backgroundImage.slice(5, -2);
    const image = new Image(); image.src = source; await image.decode();
    return { source, loaded: image.naturalWidth > 0 };
  });
  assert.equal(companion.loaded, true);
  assert.equal(companion.source, `${fixture.origin}${saved.document.items[0].appearance.config.cssStyle.src.replace('/lira-pasted-style.css', '/images/frame.webp')}`);
  fixture.updateCloud({ type: 'danmaku', liveSessionId: 'synthetic-live', name: '重载观众', message: '重新打开仍可使用' });
  for (const frame of [blivechat, blc]) await frame.getByText('重新打开仍可使用', { exact: true }).waitFor();
  assert.equal(await output.locator('.scene-version:not(.is-staging) iframe').count(), 2);
  assert.deepEqual(errors, []);
});

test('browser source addresses imported as styles render, publish and receive no desktop credentials', { timeout: 60000 }, async t => {
  const { fixture, context, page, errors } = await setup(t);
  const requests = [];
  await context.route(`${fixture.origin}/synthetic-import-source*`, route => {
    requests.push(route.request().headers());
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><h1 id="source"></h1><script>document.querySelector("#source").textContent = new URL(location.href).searchParams.get("name");</script>' });
  });
  const { dialog } = await openImport(page, 'clock');
  await dialog.getByRole('button', { name: '浏览器源地址', exact: true }).click();
  await dialog.getByLabel('浏览器源地址', { exact: true }).fill(`${fixture.origin}/synthetic-import-source?name=新导入入口&token=synthetic-provider-token`);
  await changeNumber(dialog, '网页宽度', 640);
  await changeNumber(dialog, '网页高度', 360);
  await saveStyle(dialog, '网页时钟');
  await page.frameLocator('.scene-editor-item iframe').getByText('新导入入口', { exact: true }).waitFor();
  await publish(page);
  const output = await openOutput(context, fixture);
  await output.frameLocator('.scene-version:not(.is-staging) iframe[title="网页时钟"]').getByText('新导入入口', { exact: true }).waitFor();
  assert.deepEqual(fixture.service.list()[0].document.items.map(item => item.type), ['browser']);
  assert.equal(await output.locator('.scene-version:not(.is-staging) iframe').count(), 1);
  assert.ok(requests.length >= 2);
  assert.ok(requests.every(headers => !headers.authorization && !headers.referer), 'Third-party sources receive no desktop authorization or referrer.');
  assert.deepEqual(errors, []);
});
