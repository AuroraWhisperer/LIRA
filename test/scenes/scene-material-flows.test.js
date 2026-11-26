'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { createDeflatedZip } = require('../../scripts/component-style-zip');
const { createTextBoxDefaults } = require('../../public/js/shared/text-box-config.js');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowser = useSharedBrowser();
async function setup(t, canvas = { width: 1920, height: 1080 }) {
  const fixture = await startCanvasOutputFixture({ dataDir: createScratchDirectory('scene-material-', t), notifications: true });
  const browser = openBrowser();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const desktop = await browser.newPage();
  const editor = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  for (const page of [desktop, editor]) page.setDefaultTimeout(5000);
  const scene = fixture.service.create({ title: '素材测试', canvas });
  async function openEditor() {
    const url = await openCanvasDesktop(desktop, fixture);
    assert.equal((await fetch(url)).status, 200);
    await editor.goto(url);
  }
  async function openOutput(id = fixture.service.getCanvas().outputId, itemId) {
    const source = fixture.service.getSource(id);
    const url = `${fixture.origin}/scene?id=${source.id}${itemId ? `&item=${itemId}` : ''}#token=${source.token}`;
    assert.equal((await fetch(url)).status, 200);
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(url);
    await page.locator('.scene-version:not(.is-staging)').waitFor();
    return page;
  }
  async function postStyle(action, body) {
    const binary = Buffer.isBuffer(body);
    const response = await fetch(`${fixture.origin}/api/component-styles/${action}`, { method: 'POST',
      headers: { Authorization: `Bearer ${fixture.token}`, 'Content-Type': binary ? 'application/octet-stream' : 'application/json' },
      body: binary ? body : JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, 200, result.error);
    return result.data;
  }
  return { fixture, scene, desktop, editor, openEditor, openOutput, postStyle };
}

function layer(type, config, width, height) {
  return { type, id: randomUUID(), name: type, width, height, x: 0, y: 0, visible: true, locked: false,
    appearance: { mode: 'independent', config } };
}

async function image(page, width, height) {
  const url = await page.evaluate(([w, h]) => {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    return canvas.toDataURL();
  }, [width, height]);
  return Buffer.from(url.split(',')[1], 'base64');
}

async function publish(editor) {
  await editor.getByRole('button', { name: '保存并应用', exact: true }).click();
  await editor.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
}

test('a reloaded published text box initializes again at the same output version', async t => {
  const { fixture, scene, openOutput } = await setup(t);
  const config = createTextBoxDefaults();
  config.nodes = [{ type: 'text', text: '同版文字' }];
  const saved = fixture.service.save({ id: scene.document.id, expectedRevision: scene.revision,
    document: { ...scene.document, items: [layer('text-box', config, 600, 120)] } });
  fixture.service.publish({ id: saved.document.id, expectedRevision: saved.revision });
  const page = await openOutput(saved.document.id);
  const frame = await page.locator('[data-component="text-box"]').elementHandle().then(handle => handle.contentFrame());
  await frame.getByText('同版文字', { exact: true }).waitFor();
  const ready = page.evaluate(() => new Promise(resolve => {
    function receive(event) {
      if (event.data?.type !== 'component-preview:ready') return;
      window.removeEventListener('message', receive); resolve();
    }
    window.addEventListener('message', receive);
  }));
  await frame.evaluate(() => location.reload());
  await ready;
  const nextRead = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/scene/output' && url.searchParams.get('version') === '1' && response.ok();
  });
  fixture.notify();
  await nextRead;
  await frame.getByText('同版文字', { exact: true }).waitFor();
  assert.equal(fixture.service.get(saved.document.id).publishedVersion, 1);
});

test('text image preparation keeps the old output on delay and failure, then commits a decoded image', { timeout: 20000 }, async t => {
  const { fixture, scene, openOutput } = await setup(t);
  const item = layer('text-box', createTextBoxDefaults(), 600, 120);
  const document = { ...scene.document, items: [item] };
  function publishNodes(nodes) {
    item.appearance.config.nodes = nodes;
    const saved = fixture.service.save({ id: document.id, expectedRevision: fixture.service.get(document.id).revision, document });
    fixture.service.publish({ id: document.id, expectedRevision: saved.revision });
    fixture.notify();
  }
  publishNodes([{ type: 'text', text: '旧字幕' }]);
  const page = await openOutput(document.id);
  const old = page.frameLocator('.scene-version:not(.is-staging) iframe').getByText('旧字幕');
  await old.waitFor();
  const png = await image(page, 8, 8);
  const path = `/scene-text-images/${randomUUID()}.png`;
  const blocked = Promise.withResolvers();
  const pending = Promise.withResolvers();
  await page.route(`**${path}`, async route => {
    pending.resolve(); await blocked.promise;
    await route.fulfill({ status: 503, body: '' });
  });
  publishNodes([{ type: 'image', name: '新图', src: path }]);
  await pending.promise;
  assert.ok(await old.isVisible());
  blocked.resolve();
  await page.locator('#sceneStatus').filter({ hasText: /失败|上一版本/ }).waitFor({ state: 'attached' });
  assert.ok(await old.isVisible());
  const next = `/scene-text-images/${randomUUID()}.png`;
  await page.route(`**${next}`, route => route.fulfill({ contentType: 'image/png', body: png }));
  publishNodes([{ type: 'image', name: '完成', src: next }]);
  const ready = page.frameLocator('.scene-version:not(.is-staging) iframe').getByAltText('完成');
  await ready.waitFor();
  assert.equal(await ready.evaluate(image => image.naturalWidth), 8);
});

test('first browser-source publication retains the editor scale and rotation', async t => {
  const { fixture, scene, editor, openEditor, openOutput } = await setup(t);
  const item = layer('browser', { url: `${fixture.origin}/preview-test-host`, viewportWidth: 800, viewportHeight: 600,
    styleParameters: { browser: { transform: { rotateZ: 10 }, outline: { width: 12 } } } }, 400, 300);
  fixture.service.save({ id: scene.document.id, expectedRevision: scene.revision, document: { ...scene.document, items: [item] } });
  await openEditor();
  const matrix = node => {
    const { a, b, c, d } = new DOMMatrix(getComputedStyle(node).transform);
    return [a, b, c, d];
  };
  const preview = editor.locator('.scene-editor-item[data-component="browser"] iframe');
  await preview.waitFor();
  const expected = await preview.evaluate(matrix);
  assert.ok(Math.abs(Math.hypot(expected[0], expected[1]) - 0.5) < 0.00001);
  assert.ok(Math.abs(Math.atan2(expected[1], expected[0]) * 180 / Math.PI - 10) < 0.001);
  await publish(editor);
  const output = await openOutput();
  assert.deepEqual(await output.locator('.scene-version iframe').evaluate(matrix), expected);
  const single = await openOutput(scene.document.id, item.id);
  const outline = frame => [getComputedStyle(frame).outlineWidth, getComputedStyle(frame).outlineOffset];
  assert.deepEqual(await single.locator('.scene-version iframe').evaluate(outline), ['12px', '-12px']);
  assert.deepEqual(await output.locator('.scene-version iframe').evaluate(outline), ['12px', '0px']);
});

test('updating a clock package in the feature library adds the new card to the canvas exactly once', async t => {
  const { fixture, scene, desktop, editor, postStyle, openEditor } = await setup(t);
  const png = await image(desktop, 320, 180);
  const zip = version => createDeflatedZip(new Map([['lira-pack.json', Buffer.from(JSON.stringify({
    schemaVersion: 1, id: 'test.clock-update', name: '时钟试件', version,
    styles: [{ type: 'clock', name: `时钟 ${version}`, file: 'face.png', width: 320, height: 180 }],
  }))], ['face.png', png]]));
  const first = await postStyle('inspect?target=clock', zip('1.0.0'));
  await postStyle('install', { id: first.id, target: 'clock' });
  await openEditor();
  await desktop.evaluate(async () => {
    const button = document.createElement('button');
    button.id = 'componentLibraryManage'; button.textContent = '素材管理'; document.body.append(button);
    (await import('/js/admin/component-style-client.js')).initComponentStyleLibraries();
  });
  await desktop.getByRole('button', { name: '素材管理' }).click();
  const chooser = desktop.waitForEvent('filechooser');
  await desktop.getByRole('button', { name: '更新素材包' }).click();
  await (await chooser).setFiles({ name: 'clock.zip', mimeType: 'application/zip', buffer: zip('2.0.0') });
  await desktop.getByRole('button', { name: '替换样式包' }).click();
  await desktop.getByRole('button', { name: /添加到画布：.*时钟 2\.0\.0/ }).click();
  await editor.locator('.scene-editor-item.is-selected[data-component="clock"]').waitFor();
  await publish(editor);
  const items = fixture.service.get(scene.document.id).document.items;
  assert.deepEqual(items.map(item => [item.type, item.width, item.height]), [['clock', 320, 180]]);
  assert.match(items[0].name, /2\.0\.0/);
});

test('correcting a desktop clock import adds the background once at canvas size', async t => {
  const { fixture, scene, desktop, editor, openEditor } = await setup(t);
  await openEditor();
  await desktop.evaluate(async () => {
    const host = document.createElement('section'); host.id = 'otherClockFeature';
    const list = document.createElement('div'); list.className = 'clock-style-options'; host.append(list); document.body.append(host);
    (await import('/js/admin/component-style-client.js')).initComponentStyleLibraries();
  });
  const manifest = { schemaVersion: 1, id: 'test.corrected-bg', name: '背景', version: '1.0.0',
    styles: [{ type: 'background', name: '小背景', file: 'bg.png', width: 320, height: 180 }] };
  const zip = createDeflatedZip(new Map([['lira-pack.json', Buffer.from(JSON.stringify(manifest))], ['bg.png', await image(desktop, 320, 180)]]));
  await desktop.locator('#otherClockFeature input[accept=".zip"]').setInputFiles({ name: 'bg.zip', mimeType: 'application/zip', buffer: zip });
  await desktop.getByRole('button', { name: /前往.*导入/ }).click();
  await desktop.getByRole('dialog', { name: '确认添加样式' }).getByRole('button', { name: '添加样式' }).click();
  await desktop.getByRole('button', { name: /添加到画布：.*小背景/ }).click();
  await editor.locator('.scene-editor-item.is-selected[data-component="background"]').waitFor();
  await publish(editor);
  const items = fixture.service.get(scene.document.id).document.items;
  assert.deepEqual(items.map(({ x, y, width, height }) => [x, y, width, height]), [[0, 0, 1920, 1080]]);
});

async function giftStyle(f) {
  const description = { type: 'gift-frame', filename: 'gift.png', name: '横版礼物', width: 1920, height: 1080 };
  const pack = await f.postStyle(`add?description=${encodeURIComponent(JSON.stringify(description))}`, await image(f.desktop, 1920, 1080));
  return pack.styles[0];
}

test('selecting a saved 6300 ms gift layer permits publishing other canvas changes', async t => {
  const f = await setup(t);
  const style = await giftStyle(f);
  style.config.mediaStyle.durationMs = 6300;
  const item = layer(style.type, style.config, 960, 540);
  const text = layer('text-box', createTextBoxDefaults(), 480, 120);
  const { fixture, scene, editor } = f;
  fixture.service.save({ id: scene.document.id, expectedRevision: scene.revision, document: { ...scene.document, items: [item, text] } });
  await f.openEditor();
  await editor.locator(`[data-item-id="${text.id}"].preview-canvas-layer-select`).click();
  await editor.getByRole('textbox', { name: '文本框内容' }).fill('同时保存');
  await editor.locator(`[data-item-id="${item.id}"].preview-canvas-layer-select`).click();
  const duration = editor.locator('[data-media-field="durationMs"]');
  assert.equal(await duration.inputValue(), '6300');
  await editor.getByRole('button', { name: '保存并应用', exact: true }).click();
  assert.equal(await duration.evaluate(node => node.validity.stepMismatch), false);
  await editor.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const [gift, words] = fixture.service.get(scene.document.id).document.items;
  assert.equal(gift.appearance.config.mediaStyle.durationMs, 6300);
  assert.equal(words.appearance.config.nodes[0].text, '同时保存');
});

test('a landscape gift selected on a portrait canvas keeps its proportions in the published source', async t => {
  const f = await setup(t, { width: 1080, height: 1920 });
  const style = await giftStyle(f);
  await f.openEditor();
  const { editor } = f;
  await editor.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = editor.getByRole('dialog', { name: '添加组件' });
  await picker.locator('[data-category="gift-frame"]').click();
  await picker.getByRole('button', { name: /添加到画布：横版礼物/ }).click();
  await publish(editor);
  const output = await f.openOutput();
  const frame = output.locator('.scene-version iframe[data-component="gift-frame"]');
  assert.deepEqual(await frame.evaluate(node => [node.clientWidth, node.clientHeight, node.offsetLeft, node.offsetTop]), [1080, 608, 0, 656]);
  f.fixture.receiveGift({ type: 'gift:frame', eventId: 'portrait-gift', themeId: 'imported',
    userName: '合成观众', giftName: '礼物', num: 1, totalPriceCents: 2000, styleIds: [style.config.mediaStyle.id] });
  const art = frame.contentFrame().locator('.component-media-playback img');
  await art.waitFor();
  assert.deepEqual(await art.evaluate(img => [img.naturalWidth, img.naturalHeight, img.clientWidth, img.clientHeight, getComputedStyle(img).objectFit]),
    [1920, 1080, 1080, 608, 'fill']);
});
