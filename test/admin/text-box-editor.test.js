'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

let fixture;
let browser;
test.before(async () => {
  fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html><html><head>
    <link rel="stylesheet" href="/css/shared/display-fonts.css">
    </head><body><main id="host"></main></body></html>` });
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); await fixture?.close(); });

async function mount(t, nodes = []) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route('**/scene-text-images/**', route => route.fulfill({ contentType: 'image/gif',
    body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') }));
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async (nodes) => {
    const { enhanceColorControls } = await import('/js/shared/color-control.js');
    enhanceColorControls();
    const { createTextBoxDefaults } = await import('/js/shared/text-box-config.js');
    const { mountTextBoxEditor, readTextBoxNodes } = await import('/js/admin/text-box-editor.js');
    const { mountTextBoxMedia } = await import('/js/admin/text-box-media.js');
    window.config = { ...createTextBoxDefaults(), nodes };
    window.failures = [];
    window.changes = 0;
    window.readTextBoxNodes = readTextBoxNodes;
    window.mountComposer = () => {
      window.composer = mountTextBoxEditor(document.querySelector('#host'), {
        getConfig: () => window.config,
        onChange(config) { window.config = config; window.changes++; window.composer.setConfig(config); },
        onError(error) { window.failures.push(error.message); },
      });
      window.composer.setConfig(window.config);
    };
    window.mountComposer();
    window.mediaCalls = [];
    window.pendingUploads = [];
    window.media = mountTextBoxMedia(document.querySelector('#host'), { composer: window.composer,
      onError(error) { window.failures.push(error.message); },
      async request(kind, options) {
        window.mediaCalls.push({ kind, source: options.source, name: options.file?.name });
        if (kind === 'image' && window.deferUploads) return new Promise((resolve, reject) => window.pendingUploads.push({ resolve, reject, signal: options.signal }));
        if (kind === 'image') return { imagePath: '/scene-text-images/11111111-1111-4111-8111-111111111111.gif' };
        return { gifts: [{ id: 123, name: '测试礼物', imagePath: '/img/gift-placeholder.png', giftCategory: 'normal' }] };
      },
    });
  }, nodes);
  return page;
}

async function selectText(page, text, start = 0, end = text.length) {
  await page.evaluate(({ text, start, end }) => {
    const editor = window.composer.editor;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let found;
    while (walker.nextNode()) if (walker.currentNode.data.includes(text)) { found = walker.currentNode; break; }
    if (!found) throw new Error(`Missing text: ${text}`);
    const range = document.createRange();
    const offset = found.data.indexOf(text);
    range.setStart(found, offset + start); range.setEnd(found, offset + end);
    editor.focus();
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    window.composer.rememberSelection();
  }, { text, start, end });
}

const read = page => page.evaluate(() => window.config.nodes);
const readText = async page => (await read(page)).filter(node => node.type === 'text').map(node => node.text).join('');
function letters(nodes) {
  return nodes.filter(node => node.type === 'text').flatMap(node => Array.from(node.text, text => ({ ...node, text })));
}

test('discard cancels old uploads while a new upload can still update the current draft', async t => {
  const page = await mount(t, [{ type: 'text', text: '保留' }]);
  await page.evaluate(() => { window.deferUploads = true; });
  const upload = page.locator('input[type=file]');
  const file = { name: 'test.png', mimeType: 'image/png', buffer: Buffer.from('synthetic') };
  await upload.setInputFiles(file);
  await page.waitForFunction(() => window.pendingUploads.length === 1);
  await page.evaluate(() => window.media.cancelPending());
  await upload.setInputFiles(file);
  await page.waitForFunction(() => window.pendingUploads.length === 2);
  assert.equal(await page.getByRole('button', { name: '上传中…' }).isDisabled(), true);
  await page.evaluate(() => window.pendingUploads[0].resolve({ imagePath: '/scene-text-images/11111111-1111-4111-8111-111111111111.png' }));
  assert.equal((await read(page)).filter(node => node.type === 'image').length, 0);
  assert.equal(await page.getByRole('button', { name: '上传中…' }).isDisabled(), true);
  await page.evaluate(() => window.pendingUploads[1].resolve({ imagePath: '/scene-text-images/22222222-2222-4222-8222-222222222222.png' }));
  await page.waitForFunction(() => window.config.nodes.some(node => node.type === 'image'));
  assert.equal((await read(page)).find(node => node.type === 'image').src, '/scene-text-images/22222222-2222-4222-8222-222222222222.png');
  assert.deepEqual(await page.evaluate(() => window.failures), []);
});

test('Chinese multiline input, empty trailing lines, undo/redo and plain paste keep content intact', async (t) => {
  const page = await mount(t);
  const editor = page.getByRole('textbox', { name: '文本框内容' });
  await editor.click();
  await page.keyboard.insertText('你好，直播间');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('第二行');
  assert.equal(await readText(page), '你好，直播间\n第二行');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  assert.equal(await readText(page), '你好，直播间\n第二行\n\n');
  await page.evaluate(() => window.composer.insertText('撤销测试'));
  assert.match(await readText(page), /撤销测试$/);
  await page.keyboard.press('Control+z');
  assert.equal(await readText(page), '你好，直播间\n第二行\n\n');
  await page.keyboard.press('Control+Shift+z');
  assert.match(await readText(page), /撤销测试$/);
  await page.evaluate(() => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', '<b>字面文字</b>\n粘贴第二行');
    clipboardData.setData('text/html', '<img src=x onerror="window.pasteExecuted=true"><b>字面文字</b>');
    window.composer.editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  assert.match(await readText(page), /<b>字面文字<\/b>\n粘贴第二行$/);
  assert.equal(await editor.locator('img').count(), 0);
  assert.equal(await page.evaluate(() => Boolean(window.pasteExecuted)), false);
  assert.deepEqual(await page.evaluate(() => window.failures), []);
});

test('keyboard marks toggle repeatedly and toolbar formatting stays limited to the selection', async (t) => {
  const page = await mount(t, [{ type: 'text', text: '甲乙丙丁' }]);
  await selectText(page, '甲乙丙丁', 1, 3);
  await page.keyboard.press('Control+b');
  assert.deepEqual(letters(await read(page)).map(node => Boolean(node.bold)), [false, true, true, false]);
  await page.keyboard.press('Control+b');
  assert.deepEqual(letters(await read(page)).map(node => Boolean(node.bold)), [false, false, false, false]);
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+i');
  await page.keyboard.press('Control+u');
  for (const mark of ['bold', 'italic', 'underline']) {
    assert.deepEqual(letters(await read(page)).map(node => Boolean(node[mark])), [false, true, true, false], mark);
  }
  await page.getByRole('combobox', { name: '文字字号' }).selectOption('48');
  assert.equal(await page.evaluate(() => getSelection().toString()), '乙丙');
  assert.deepEqual(letters(await read(page)).map(node => node.fontSize || 32), [32, 48, 48, 32]);
  assert.deepEqual(letters(await read(page)).map(node => Boolean(node.bold)), [false, true, true, false],
    `font size preserves bold: ${await page.locator('.text-box-editor').innerHTML()}`);
  await page.getByRole('button', { name: '文字颜色', exact: true }).click();
  await page.getByLabel('自定义文字颜色', { exact: true }).fill('#ff0000');
  assert.equal(await page.evaluate(() => getSelection().toString()), '乙丙');
  assert.equal(await page.getByRole('combobox', { name: '文字字号' }).inputValue(), '48');
  assert.deepEqual(letters(await read(page)).map(node => node.color || '#ffffff'), ['#ffffff', '#ff0000', '#ff0000', '#ffffff']);
  for (const mark of ['bold', 'italic', 'underline']) {
    assert.deepEqual(letters(await read(page)).map(node => Boolean(node[mark])), [false, true, true, false], mark);
  }
  await page.locator('.text-box-editor').focus();
  await page.keyboard.press('Control+z');
  assert.deepEqual(letters(await read(page)).map(node => node.color || '#ffffff'), Array(4).fill('#ffffff'));
  assert.deepEqual(letters(await read(page)).map(node => node.fontSize || 32), [32, 48, 48, 32]);
  await page.keyboard.press('Control+Shift+z');
  assert.deepEqual(letters(await read(page)).map(node => node.color || '#ffffff'), ['#ffffff', '#ff0000', '#ff0000', '#ffffff']);
});

test('large multiline paste uses one native edit, preserves final newlines and remains undoable', async t => {
  const page = await mount(t, [{ type: 'text', text: '公告', bold: true }]);
  await selectText(page, '公告');
  const text = `${'直播间公告\n'.repeat(2000)}<img src=x onerror=alert(1)>\n\n`;
  const result = await page.evaluate(text => {
    let inputs = 0;
    window.composer.editor.addEventListener('input', () => inputs++);
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    const start = performance.now();
    window.composer.editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    return { inputs, ms: performance.now() - start, elements: window.composer.editor.querySelectorAll('*').length,
      changes: window.changes, images: window.composer.editor.querySelectorAll('img').length };
  }, text);
  assert.ok(await readText(page) === text, 'all lines, literal markup and final newlines survive the paste');
  assert.equal(result.inputs, 1);
  assert.equal(result.changes, 1);
  assert.equal(result.images, 0);
  assert.ok(result.elements < 10, 'paste must not create a DOM block for every line');
  assert.ok((await read(page)).every(node => node.bold), 'plain-text paste retains the insertion style');
  await page.keyboard.press('Control+z');
  assert.equal(await readText(page), '公告');
  await page.keyboard.press('Control+Shift+z');
  assert.ok(await readText(page) === text);
  t.diagnostic(`multiline paste: ${text.length} characters, ${result.ms.toFixed(1)} ms, ${result.elements} elements`);
});

test('nested styles preserve underline from ancestors and only a terminal placeholder BR is ignored', async (t) => {
  const page = await mount(t);
  const result = await page.evaluate(() => {
    window.composer.editor.innerHTML = '<span style="text-decoration:underline"><span style="color:rgba(255,0,0,0.35)">嵌套</span></span><div><br></div><div><br></div>';
    return window.readTextBoxNodes(window.composer.editor, window.config);
  });
  assert.equal(result.map(node => node.text).join(''), '嵌套\n\n');
  assert.equal(result[0].underline, true);
  assert.equal(result[0].color, '#ff000059');
});

test('the floating color picker retains the text selection while editing alpha', async t => {
  const page = await mount(t, [{ type: 'text', text: '透明文字' }]);
  await page.locator('.text-box-editor').focus();
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: '文字颜色', exact: true }).click();
  await page.getByLabel('自定义文字颜色', { exact: true }).click();
  const picker = page.getByRole('dialog', { name: '颜色与不透明度' });
  await picker.getByLabel('不透明度（%）', { exact: true }).fill('35');
  assert.equal((await read(page))[0].color, '#ffffff59');
  await picker.getByLabel('红色 R', { exact: true }).fill('170');
  assert.equal((await read(page))[0].color, '#aaffff59');
  await picker.press('Escape');
  assert.equal(await picker.isVisible(), false);
  assert.equal((await read(page))[0].text, '透明文字');
});

test('mixed underline selection becomes uniformly underlined and toggles off without changing media', async (t) => {
  const gift = { type: 'gift', name: '舰长', src: '/img/admin/gifts/bilibili-guard-captain.webp' };
  const original = [{ type: 'text', text: '甲', underline: true }, gift,
    { type: 'text', text: '乙' }, { type: 'text', text: '丙', underline: true }];
  const page = await mount(t, original);
  await page.locator('.text-box-editor').focus();
  await page.keyboard.press('Control+a');
  const toggle = page.getByRole('button', { name: '下划线 (Ctrl+U)', exact: true });
  assert.equal(await toggle.getAttribute('aria-pressed'), 'mixed');
  await toggle.click();
  assert.ok(letters(await read(page)).every(node => node.underline));
  assert.deepEqual((await read(page)).find(node => node.type === 'gift'), gift);
  await page.keyboard.press('Control+u');
  assert.ok(letters(await read(page)).every(node => !node.underline));
  await page.keyboard.press('Control+z');
  assert.ok(letters(await read(page)).every(node => node.underline));
  await page.keyboard.press('Control+z');
  assert.deepEqual(await read(page), original);
  await page.keyboard.press('Control+Shift+z');
  assert.ok(letters(await read(page)).every(node => node.underline));
});

test('formatting appears above selected text only and never changes defaults from an empty selection', async (t) => {
  const page = await mount(t, [{ type: 'text', text: '欢迎来到直播间' }]);
  page.setDefaultTimeout(5000);
  await page.addStyleTag({ url: `${fixture.origin}/css/components/select-menu.css` });
  await page.addStyleTag({ url: `${fixture.origin}/css/admin/text-box.css` });
  await page.addStyleTag({ content: '#host { margin: 100px 60px; }' });
  const toolbar = page.getByRole('toolbar', { name: '文字格式' });
  assert.equal(await toolbar.isVisible(), false);
  await selectText(page, '欢迎来到直播间', 2, 2);
  for (const key of ['b', 'i', 'u']) await page.keyboard.press(`Control+${key}`);
  assert.deepEqual(await read(page), [{ type: 'text', text: '欢迎来到直播间' }]);
  assert.equal(await toolbar.isVisible(), false);
  await selectText(page, '欢迎来到直播间', 2, 4);
  await toolbar.waitFor({ state: 'visible' });
  const selectedBounds = await page.evaluate(() => { const rect = getSelection().getRangeAt(0).getBoundingClientRect(); return { top: rect.top }; });
  const toolbarBounds = await toolbar.boundingBox();
  assert.ok(toolbarBounds.y + toolbarBounds.height < selectedBounds.top);
  assert.ok(toolbarBounds.x >= (await page.locator('.text-box-editor').boundingBox()).x);
  await page.evaluate(async () => { const { enhanceSelects } = await import('/js/shared/select-menu.js'); enhanceSelects(); });
  await page.getByRole('button', { name: '文字字号', exact: true }).click();
  await page.getByRole('option', { name: '48', exact: true }).click();
  assert.equal(await page.evaluate(() => getSelection().toString()), '来到');
  assert.deepEqual(letters(await read(page)).map(node => node.fontSize || 32), [32, 32, 48, 48, 32, 32, 32]);
  await page.getByRole('button', { name: '加粗 (Ctrl+B)', exact: true }).click();
  assert.deepEqual(letters(await read(page)).map(node => Boolean(node.bold)), [false, false, true, true, false, false, false]);
  await page.keyboard.press('ArrowRight');
  await toolbar.waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    const size = document.querySelector('.rich-text-font-size');
    size.value = '72'; size.dispatchEvent(new Event('change'));
  });
  assert.equal(await page.evaluate(() => window.config.fontSize), 32);
  assert.deepEqual(letters(await read(page)).map(node => node.fontSize || 32), [32, 32, 48, 48, 32, 32, 32]);
});

test('formatting a selection across different marks retains each mark and supports separate size/color undo and redo', async (t) => {
  const page = await mount(t, [{ type: 'text', text: '首甲', bold: true },
    { type: 'text', text: '乙', italic: true }, { type: 'text', text: '丙尾', underline: true }]);
  await page.evaluate(() => {
    const editor = window.composer.editor;
    const range = document.createRange();
    range.setStart(editor.children[0].firstChild, 1);
    range.setEnd(editor.children[2].firstChild, 1);
    editor.focus();
    getSelection().removeAllRanges(); getSelection().addRange(range);
    window.composer.rememberSelection();
  });
  await page.getByRole('combobox', { name: '文字字号' }).selectOption('48');
  assert.equal(await page.evaluate(() => getSelection().toString()), '甲乙丙');
  await page.getByRole('button', { name: '文字颜色', exact: true }).click();
  await page.getByLabel('自定义文字颜色', { exact: true }).fill('#00ff00');
  assert.equal(await page.evaluate(() => getSelection().toString()), '甲乙丙');
  const marks = nodes => letters(nodes).map(node => [Boolean(node.bold), Boolean(node.italic), Boolean(node.underline)]);
  const expectedMarks = [[true, false, false], [true, false, false], [false, true, false], [false, false, true], [false, false, true]];
  assert.deepEqual(marks(await read(page)), expectedMarks);
  assert.deepEqual(letters(await read(page)).map(node => node.fontSize || 32), [32, 48, 48, 48, 32]);
  assert.deepEqual(letters(await read(page)).map(node => node.color || '#ffffff'), ['#ffffff', '#00ff00', '#00ff00', '#00ff00', '#ffffff']);
  await page.locator('.text-box-editor').focus();
  await page.keyboard.press('Control+z');
  assert.deepEqual(letters(await read(page)).map(node => node.color || '#ffffff'), Array(5).fill('#ffffff'));
  assert.deepEqual(letters(await read(page)).map(node => node.fontSize || 32), [32, 48, 48, 48, 32]);
  await page.keyboard.press('Control+z');
  assert.deepEqual(letters(await read(page)).map(node => node.fontSize || 32), Array(5).fill(32));
  assert.deepEqual(marks(await read(page)), expectedMarks);
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  assert.deepEqual(letters(await read(page)).map(node => node.fontSize || 32), [32, 48, 48, 48, 32]);
  assert.deepEqual(letters(await read(page)).map(node => node.color || '#ffffff'), ['#ffffff', '#00ff00', '#00ff00', '#00ff00', '#ffffff']);
  assert.deepEqual(marks(await read(page)), expectedMarks);
});

test('gift chips are indivisible, removable with undo, and media inserts preserve images and kaomoji', async (t) => {
  const page = await mount(t, [{ type: 'text', text: '开头' }]);
  await selectText(page, '开头', 2, 2);
  await page.getByRole('button', { name: '礼物图片', exact: true }).click();
  await page.getByRole('button').filter({ hasText: '测试礼物' }).click();
  await page.getByRole('button', { name: '插入礼物图片', exact: true }).click();
  const chip = page.locator('.text-box-editor [data-text-box-node]');
  assert.equal(await chip.getAttribute('contenteditable'), 'false');
  assert.equal((await read(page)).filter(node => node.type === 'gift').length, 1);
  await page.keyboard.insertText('后续文字');
  assert.deepEqual((await read(page)).map(node => node.type === 'text' ? node.text : node.type), ['开头', 'gift', '后续文字']);
  await chip.click();
  assert.equal(await page.getByRole('toolbar', { name: '文字格式' }).isVisible(), false);
  await page.keyboard.press('Backspace');
  assert.equal(await chip.count(), 0);
  assert.equal(await readText(page), '开头后续文字');
  await page.keyboard.press('Control+z');
  assert.equal(await chip.count(), 1);
  assert.equal((await read(page)).filter(node => node.type === 'gift').length, 1);
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: '颜文字 / 表情', exact: true }).click();
  await page.getByRole('button', { name: '(≧▽≦)', exact: true }).click();
  assert.match(await readText(page), /\(≧▽≦\)/);
  await page.locator('input[type=file]').setInputFiles({ name: '动画.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
  await page.waitForFunction(() => window.config.nodes.some(node => node.type === 'image'));
  assert.equal((await read(page)).find(node => node.type === 'image').src, '/scene-text-images/11111111-1111-4111-8111-111111111111.gif');
  assert.deepEqual(await page.evaluate(() => window.failures), []);
  assert.equal(await page.evaluate(() => window.mediaCalls.filter(call => call.kind === 'image').length), 1);
});

test('stroke and shadow affect selected text only, preserve marks and support native undo', async (t) => {
  const page = await mount(t, [{ type: 'text', text: '甲乙丙丁', bold: true }]);
  page.setDefaultTimeout(5000);
  await selectText(page, '甲乙丙丁', 1, 3);
  await page.getByRole('button', { name: '更多文字格式', exact: true }).click();
  await page.getByRole('button', { name: '文字描边', exact: true }).click();
  assert.deepEqual(letters(await read(page)).map(node => Boolean(node.stroke)), [false, true, true, false]);
  assert.equal(await page.getByRole('button', { name: '文字描边', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '轻阴影', exact: true }).click();
  assert.deepEqual(letters(await read(page)).map(node => Boolean(node.shadow)), [false, true, true, false]);
  assert.ok(letters(await read(page)).every(node => node.bold));
  assert.equal(await page.evaluate(() => getSelection().toString()), '乙丙');
  await page.keyboard.press('Control+z');
  assert.ok(letters(await read(page)).every(node => !node.shadow));
  assert.deepEqual(letters(await read(page)).map(node => Boolean(node.stroke)), [false, true, true, false]);
  await page.keyboard.press('Control+Shift+z');
  assert.deepEqual(letters(await read(page)).map(node => Boolean(node.shadow)), [false, true, true, false]);
  await selectText(page, '乙丙');
  await page.getByRole('button', { name: '更多文字格式', exact: true }).click();
  await page.getByRole('button', { name: '文字描边', exact: true }).click();
  assert.ok(letters(await read(page)).every(node => !node.stroke));
  assert.deepEqual(letters(await read(page)).map(node => Boolean(node.shadow)), [false, true, true, false]);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('group', { name: '文字效果', exact: true }).isVisible(), false);
  assert.deepEqual(await page.evaluate(() => window.failures), []);
});

async function mountPreview(t) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  t.after(() => page.close());
  page.setDefaultTimeout(5000);
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(`${fixture.origin}/text-box?preview=1&componentPreview=1`)).status, 200);
  await page.goto(url);
  await page.addStyleTag({ url: `${fixture.origin}/css/admin/component-preview.css` });
  await page.addStyleTag({ content: '#host { display: flex; gap: 24px; margin-top: 160px; } .component-preview-stage { width: 640px; height: 180px; flex: none; }' });
  await page.evaluate(async () => {
    await import('/js/admin/contextual-help.js');
    const { createTextBoxPreview } = await import('/js/admin/text-box-preview.js');
    const { createTextBoxDefaults } = await import('/js/shared/text-box-config.js');
    const { createComponentConfigController } = await import('/js/admin/component-config-controller.js');
    const { mountComponentPreview } = await import('/js/admin/component-preview-surface.js');
    const controller = createComponentConfigController({ initial: createTextBoxDefaults(), persist: async config => config });
    window.controller = controller;
    const definition = createTextBoxPreview();
    const editorHost = document.createElement('div');
    const previewHost = document.createElement('div');
    document.getElementById('host').append(editorHost, previewHost);
    definition.createPanel(editorHost, controller);
    mountComponentPreview(previewHost, { ...definition, controller });
  });
  await page.frameLocator('.component-preview-frame').locator('#textBox span').waitFor();
  return page;
}

test('scroll switches are exclusive and preserve long editable text and native undo', async (t) => {
  const page = await mountPreview(t);
  await page.addStyleTag({ url: `${fixture.origin}/css/admin/text-box.css` });
  await page.addStyleTag({ url: `${fixture.origin}/css/components/switch-control.css` });
  await page.addStyleTag({ url: `${fixture.origin}/css/components/contextual-help.css` });
  await page.addStyleTag({ url: `${fixture.origin}/css/components/parameter-range.css` });
  const editor = page.getByRole('textbox', { name: '文本框内容' });
  const horizontal = page.getByRole('switch', { name: '横向滚动' });
  const vertical = page.getByRole('switch', { name: '纵向滚动' });
  const speed = page.getByRole('slider', { name: '滚动速度', exact: true });
  assert.equal(await horizontal.isChecked(), false);
  assert.equal(await vertical.isChecked(), false);
  assert.equal(await speed.inputValue(), '40');
  assert.equal(await speed.isDisabled(), true);
  const help = page.getByRole('button', { name: '自动滚动说明' });
  await help.focus();
  assert.equal(await help.getAttribute('aria-expanded'), 'true');
  assert.match(await page.getByRole('tooltip').textContent(), /两个方向只能启用一个/);
  await help.press('Escape');
  assert.equal(await help.getAttribute('aria-expanded'), 'false');
  const text = '第一行公告\n第二行内容'.repeat(1000);
  await editor.focus();
  await page.keyboard.press('Control+a');
  await page.evaluate(text => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    document.querySelector('.text-box-editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, text);
  await page.evaluate(() => { window.originalEditorNode = document.querySelector('.text-box-editor').firstChild; });
  await horizontal.check();
  assert.equal(await vertical.isChecked(), false);
  assert.equal(await speed.isDisabled(), false);
  await speed.fill('85');
  await speed.press('ArrowRight');
  assert.equal(await page.evaluate(() => window.controller.getState().draft.scrollSpeed), 86);
  assert.equal(await page.locator('.text-box-speed-value').textContent(), '86 像素/秒');
  await vertical.check();
  assert.equal(await horizontal.isChecked(), false);
  assert.equal(await speed.inputValue(), '86');
  assert.equal(await page.evaluate(() => window.controller.getState().draft.scrollMode), 'vertical');
  assert.ok(await page.evaluate(text => window.controller.getState().draft.nodes.map(node => node.text || '').join('') === text, text),
    'switching playback preserves every line in the editable configuration');
  assert.equal(await page.evaluate(() => window.originalEditorNode === document.querySelector('.text-box-editor').firstChild), true);
  await editor.focus();
  await page.keyboard.press('Control+z');
  assert.equal(await editor.textContent(), '在这里输入文字');
  assert.equal(await vertical.isChecked(), true);
  await vertical.uncheck();
  assert.equal(await page.evaluate(() => window.controller.getState().draft.scrollMode), 'none');
  assert.equal(await speed.isDisabled(), true);
  assert.equal(await speed.inputValue(), '86');
});

test('text effects visibly update the live preview and disappear when toggled off', async (t) => {
  const page = await mountPreview(t);
  const output = page.frameLocator('.component-preview-frame').locator('#textBox');
  await output.locator('span').waitFor();
  const frame = page.frames().find(frame => new URL(frame.url()).pathname === '/text-box');
  const waitForEffects = (stroke, shadow) => frame.waitForFunction(({ stroke, shadow }) => {
    const node = document.querySelector('#textBox span');
    if (!node) return false;
    const style = getComputedStyle(node);
    return (parseFloat(style.webkitTextStrokeWidth) > 0) === stroke && (style.textShadow !== 'none') === shadow;
  }, { stroke, shadow });
  const toggle = name => page.getByRole('button', { name, exact: true }).click();
  const background = page.getByLabel('文本框检查底色', { exact: true });
  for (const color of ['dark', 'light']) {
    await background.selectOption(color);
    const plain = await output.screenshot();
    await page.getByRole('textbox', { name: '文本框内容' }).focus();
    await page.keyboard.press('Control+a');
    await toggle('更多文字格式');
    await toggle('文字描边');
    await waitForEffects(true, false);
    assert.notDeepEqual(await output.screenshot(), plain, `${color}: stroke changes preview pixels`);
    await toggle('文字描边');
    await waitForEffects(false, false);
    await toggle('轻阴影');
    await waitForEffects(false, true);
    const shadow = await output.screenshot();
    assert.notDeepEqual(shadow, plain, `${color}: shadow changes preview pixels`);
    await toggle('文字描边');
    await waitForEffects(true, true);
    assert.notDeepEqual(await output.screenshot(), shadow, `${color}: effects work together`);
    await toggle('文字描边');
    await toggle('轻阴影');
    await waitForEffects(false, false);
    assert.deepEqual(await output.screenshot(), plain, `${color}: toggling off restores plain text`);
    await page.keyboard.press('Escape');
  }
});

test('rapid format toggles preserve content and undo without accumulating markup', async (t) => {
  const page = await mountPreview(t);
  await page.getByLabel('文本框检查底色', { exact: true }).selectOption('dark');
  await page.evaluate(async () => {
    const { enhanceSelects } = await import('/js/shared/select-menu.js');
    enhanceSelects();
    const gift = { type: 'gift', name: '舰长', src: '/img/admin/gifts/bilibili-guard-captain.webp' };
    controller.edit({ nodes: [{ type: 'text', text: '在这里输入文字' }, gift, gift] });
  });
  await page.locator('.text-box-editor').focus();
  await page.keyboard.press('Control+a');
  for (let cycle = 0; cycle < 60; cycle++) {
    for (const name of ['加粗 (Ctrl+B)', '斜体 (Ctrl+I)', '下划线 (Ctrl+U)']) {
      await page.getByRole('button', { name, exact: true }).click();
    }
    const more = page.getByRole('button', { name: '更多文字格式', exact: true });
    if (await more.getAttribute('aria-expanded') === 'false') await more.click();
    await page.getByRole('button', { name: '文字描边', exact: true }).click();
    await page.getByRole('button', { name: '轻阴影', exact: true }).click();
  }
  const result = await page.evaluate(() => ({ nodes: controller.getState().draft.nodes,
    elements: document.querySelector('.text-box-editor').querySelectorAll('*').length }));
  assert.equal(result.nodes[0].text, '在这里输入文字');
  for (const key of ['bold', 'italic', 'underline', 'stroke', 'shadow']) assert.ok(!result.nodes[0][key], key);
  assert.equal(result.nodes.filter(node => node.type === 'gift').length, 2);
  assert.ok(result.elements < 20, 'repeated formatting must not accumulate nested wrappers');
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => controller.getState().draft.nodes[0].shadow), true);
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await page.evaluate(() => Boolean(controller.getState().draft.nodes[0].shadow)), false);
  await page.locator('.text-box-editor').focus();
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: '下划线 (Ctrl+U)', exact: true }).click();
  const output = page.frameLocator('.component-preview-frame').locator('#textBox > span').first();
  const frame = page.frames().find(frame => new URL(frame.url()).pathname === '/text-box');
  await frame.waitForFunction(() => getComputedStyle(document.querySelector('#textBox > span')).textDecorationLine === 'underline');
  assert.equal(await output.evaluate(node => getComputedStyle(node).textDecorationSkipInk), 'none');
  assert.ok(await output.evaluate(node => parseFloat(getComputedStyle(node).textUnderlineOffset) > 0));
  const underlineIsVisible = async () => {
    const png = await output.screenshot();
    return page.evaluate(async base64 => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let y = Math.floor(canvas.height / 2); y < canvas.height; y++) {
        let white = 0;
        for (let x = 0; x < canvas.width; x++) {
          const offset = (y * canvas.width + x) * 4;
          if (data[offset] > 220 && data[offset + 1] > 220 && data[offset + 2] > 220) white++;
        }
        if (white > canvas.width * 0.9) return true;
      }
      return false;
    }, png.toString('base64'));
  };
  assert.equal(await underlineIsVisible(), true, 'the underline spans the whole Chinese text');
  const more = page.getByRole('button', { name: '更多文字格式', exact: true });
  if (await more.getAttribute('aria-expanded') === 'false') await more.click();
  await page.getByRole('button', { name: '文字描边', exact: true }).click();
  await page.getByRole('button', { name: '轻阴影', exact: true }).click();
  await frame.waitForFunction(() => {
    const style = getComputedStyle(document.querySelector('#textBox > span'));
    return parseFloat(style.webkitTextStrokeWidth) > 0 && style.textShadow !== 'none';
  });
  assert.equal(await underlineIsVisible(), true, 'stroke and shadow must not paint the underline black');
});

test('clear format resets mixed selected text in one undo step while keeping media and unselected styles', async (t) => {
  const style = { bold: true, italic: true, underline: true, stroke: true, shadow: true, fontSize: 48, color: '#ff0000' };
  const gift = { type: 'gift', name: '舰长', src: '/img/admin/gifts/bilibili-guard-captain.webp', fontSize: 64 };
  const image = { type: 'image', name: '表情', src: '/scene-text-images/11111111-1111-4111-8111-111111111111.gif', fontSize: 40 };
  const original = [{ type: 'text', text: '首甲', ...style }, gift, image, { type: 'text', text: '乙尾', ...style }];
  const page = await mount(t, original);
  page.setDefaultTimeout(5000);
  await page.evaluate(() => {
    const editor = window.composer.editor;
    const range = document.createRange();
    range.setStart(editor.firstElementChild.firstChild, 1);
    range.setEnd(editor.lastElementChild.firstChild, 1);
    editor.focus(); getSelection().removeAllRanges(); getSelection().addRange(range);
    window.composer.rememberSelection();
  });
  await page.getByRole('button', { name: '更多文字格式', exact: true }).click();
  await page.getByRole('button', { name: '清除格式', exact: true }).click();
  const expected = [{ type: 'text', text: '首', ...style }, { type: 'text', text: '甲' }, gift, image,
    { type: 'text', text: '乙' }, { type: 'text', text: '尾', ...style }];
  assert.deepEqual(await read(page), expected, await page.locator('.text-box-editor').innerHTML());
  assert.equal(await page.getByRole('group', { name: '文字效果', exact: true }).isVisible(), false);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await read(page), original);
  await page.keyboard.press('Control+Shift+z');
  assert.deepEqual(await read(page), expected);
  await selectText(page, '尾');
  await page.getByRole('button', { name: '更多文字格式', exact: true }).click();
  await page.getByRole('button', { name: '清除格式', exact: true }).click();
  assert.equal(letters(await read(page)).at(-1).underline, undefined, 'reset also removes an inherited underline');
  assert.deepEqual(await page.evaluate(() => window.failures), []);
});

test('palette preserves selection, keeps six distinct recent colors across remount and closes with Escape or selection loss', async (t) => {
  const page = await mount(t, [{ type: 'text', text: '前选后' }]);
  page.setDefaultTimeout(5000);
  await page.addStyleTag({ url: `${fixture.origin}/css/admin/text-box.css` });
  await page.addStyleTag({ content: '#host { margin: 100px 60px; }' });
  await selectText(page, '前选后', 1, 2);
  const openPalette = () => page.getByRole('button', { name: '文字颜色', exact: true }).click();
  const palette = page.getByRole('group', { name: '文字颜色选项', exact: true });
  await openPalette();
  const panelBounds = await palette.boundingBox();
  assert.ok(panelBounds.x >= 0 && panelBounds.y >= 0 && panelBounds.x + panelBounds.width <= page.viewportSize().width);
  assert.equal(await palette.getByRole('button', { name: /最近颜色/ }).count(), 0);
  await page.getByRole('button', { name: '蓝色 #4dabf7', exact: true }).click();
  assert.deepEqual(letters(await read(page)).map(node => node.color || '#ffffff'), ['#ffffff', '#4dabf7', '#ffffff']);
  assert.equal(await palette.isVisible(), false);
  assert.equal(await page.evaluate(() => getSelection().toString()), '选');
  await openPalette();
  const custom = page.getByLabel('自定义文字颜色', { exact: true });
  for (const color of ['#123456', '#223456', '#323456', '#423456', '#523456', '#623456', '#123456']) await custom.fill(color);
  assert.equal(await palette.getByRole('button', { name: /最近颜色/ }).count(), 6);
  assert.equal(await palette.getByRole('button', { name: '最近颜色 #123456', exact: true }).count(), 1);
  const selectedBounds = await page.evaluate(() => { const rect = getSelection().getRangeAt(0).getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; });
  const populatedBounds = await palette.boundingBox();
  assert.ok(populatedBounds.y + populatedBounds.height < selectedBounds.top || populatedBounds.y > selectedBounds.bottom,
    'the populated palette leaves selected text visible');
  await page.getByRole('button', { name: '最近颜色 #123456', exact: true }).focus();
  await page.keyboard.press('Escape');
  assert.equal(await palette.isVisible(), false);
  assert.equal(await page.getByRole('toolbar').isVisible(), true);
  await page.evaluate(() => { window.composer.dispose(); window.mountComposer(); });
  await selectText(page, '选');
  await openPalette();
  assert.equal(await palette.getByRole('button', { name: /最近颜色/ }).count(), 6);
  await page.getByRole('button', { name: '默认颜色', exact: true }).click();
  assert.ok(letters(await read(page)).every(node => !node.color));
  await openPalette();
  await page.evaluate(() => { const range = getSelection().getRangeAt(0); range.collapse(false); document.dispatchEvent(new Event('selectionchange')); });
  assert.equal(await palette.isVisible(), false);
  assert.equal(await page.getByRole('toolbar').isVisible(), false);
  assert.deepEqual(await page.evaluate(() => window.failures), []);
});

test('disposing and remounting releases document handlers and inserts once per action', async (t) => {
  const page = await mount(t);
  const signals = await page.evaluate(() => {
    window.media.dispose(); window.composer.dispose();
    const original = document.addEventListener;
    const recorded = [];
    document.addEventListener = function (type, callback, options) {
      if (['selectionchange', 'scroll', 'pointerdown', 'keydown'].includes(type) && options?.signal) recorded.push(options.signal);
      return original.call(this, type, callback, options);
    };
    window.mountComposer(); window.composer.dispose(); window.mountComposer();
    document.addEventListener = original;
    document.dispatchEvent(new Event('selectionchange'));
    document.dispatchEvent(new Event('scroll'));
    window.composer.insertText('只插入一次');
    return { total: recorded.length, active: recorded.filter(signal => !signal.aborted).length };
  });
  assert.deepEqual(signals, { total: 8, active: 4 });
  assert.equal(await readText(page), '只插入一次');
  assert.equal(await page.locator('.text-box-editor').count(), 1);
});

test('the shared font menu retains the selected text and supports undo, default font and clearing', async t => {
  const page = await mount(t, [{ type: 'text', text: '前选后', bold: true }]);
  await page.addStyleTag({ url: `${fixture.origin}/css/admin/text-box.css` });
  await page.addStyleTag({ url: `${fixture.origin}/css/components/select-menu.css` });
  await page.addStyleTag({ content: '#host { margin: 180px 60px; }' });
  await page.evaluate(async () => { const { enhanceSelects } = await import('/js/shared/select-menu.js'); enhanceSelects(); });
  await selectText(page, '前选后', 1, 2);
  await page.getByRole('button', { name: '文字字体', exact: true }).click();
  await page.getByRole('searchbox', { name: '文字字体：搜索', exact: true }).fill('小赖');
  await page.getByRole('option', { name: '小赖字体 · 软萌手写', exact: true }).click();
  assert.equal(await page.evaluate(() => getSelection().toString()), '选');
  assert.deepEqual(letters(await read(page)).map(node => node.fontFamily || ''), ['', '"Lira Xiaolai"', '']);
  assert.ok(letters(await read(page)).every(node => node.bold));
  await page.locator('.text-box-editor').focus();
  await page.keyboard.press('Control+z');
  assert.ok(letters(await read(page)).every(node => !node.fontFamily));
  await page.keyboard.press('Control+Shift+z');
  assert.equal(letters(await read(page))[1].fontFamily, '"Lira Xiaolai"');
  await selectText(page, '选');
  await page.locator('.rich-text-font-family').selectOption('');
  assert.ok(letters(await read(page)).every(node => !node.fontFamily));
  await page.locator('.rich-text-font-family').selectOption('"Lira Maiyuan"');
  await page.getByRole('button', { name: '更多文字格式', exact: true }).click();
  await page.getByRole('button', { name: '清除格式', exact: true }).click();
  assert.deepEqual(letters(await read(page)), [
    { type: 'text', text: '前', bold: true }, { type: 'text', text: '选' }, { type: 'text', text: '后', bold: true },
  ]);
  assert.deepEqual(await page.evaluate(() => window.failures), []);
});
