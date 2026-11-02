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
  await page.evaluate(() => window.pendingUploads[0].resolve({ imagePath: '/scene-text-images/11111111-1111-4111-8111-111111111111.png' }));
  assert.equal((await read(page)).filter(node => node.type === 'image').length, 0);
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

test('large multiline paste uses one native edit, preserves final newlines and remains undoable', async t => {
  const page = await mount(t, [{ type: 'text', text: '公告', bold: true }]);
  await selectText(page, '公告');
  const text = `${'直播间公告\n'.repeat(2000)}<img src=x onerror=alert(1)>\n\n`;
  const result = await page.evaluate(text => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    window.composer.editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    return { elements: window.composer.editor.querySelectorAll('*').length,
      images: window.composer.editor.querySelectorAll('img').length };
  }, text);
  assert.ok(await readText(page) === text, 'all lines, literal markup and final newlines survive the paste');
  assert.equal(result.images, 0);
  assert.ok(result.elements < 10, 'paste must not create a DOM block for every line');
  await page.keyboard.press('Control+z');
  assert.equal(await readText(page), '公告');
  await page.keyboard.press('Control+Shift+z');
  assert.ok(await readText(page) === text);
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

test('the floating color picker applies alpha edits to the selected text', async t => {
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
  assert.equal((await read(page))[0].text, '透明文字');
});

test('mixed underline selection becomes uniformly underlined and toggles off without changing media', async (t) => {
  const gift = { type: 'gift', name: '舰长', src: '/img/admin/gifts/bilibili-guard-captain.webp' };
  const original = [{ type: 'text', text: '甲', underline: true }, gift,
    { type: 'text', text: '乙' }, { type: 'text', text: '丙', underline: true }];
  const page = await mount(t, original);
  await page.locator('.text-box-editor').focus();
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: '下划线 (Ctrl+U)', exact: true }).click();
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

test('formatting applies only to selected text and leaves defaults unchanged for an empty selection', async (t) => {
  const page = await mount(t, [{ type: 'text', text: '欢迎来到直播间' }]);
  page.setDefaultTimeout(5000);
  const toolbar = page.getByRole('toolbar', { name: '文字格式' });
  await selectText(page, '欢迎来到直播间', 2, 2);
  for (const key of ['b', 'i', 'u']) await page.keyboard.press(`Control+${key}`);
  assert.deepEqual(await read(page), [{ type: 'text', text: '欢迎来到直播间' }]);
  await selectText(page, '欢迎来到直播间', 2, 4);
  await toolbar.waitFor({ state: 'visible' });
  await page.evaluate(async () => { const { enhanceSelects } = await import('/js/shared/select-menu.js'); enhanceSelects(); });
  await page.getByRole('button', { name: '文字字号', exact: true }).click();
  await page.getByRole('option', { name: '48', exact: true }).click();
  assert.deepEqual(letters(await read(page)).map(node => node.fontSize || 32), [32, 32, 48, 48, 32, 32, 32]);
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
  await page.getByRole('button', { name: '文字颜色', exact: true }).click();
  await page.getByLabel('自定义文字颜色', { exact: true }).fill('#00ff00');
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

test('editable media uses the output font size and scales with selected text', async t => {
  const page = await mount(t, [{ type: 'text', text: '图片说明' },
    { type: 'gift', name: '舰长', src: '/img/admin/gifts/bilibili-guard-captain.webp' },
    { type: 'image', name: '图片', src: '/scene-text-images/11111111-1111-4111-8111-111111111111.gif', fontSize: 64 }]);
  const sizes = () => page.evaluate(async () => {
    const { renderTextBox } = await import('/js/shared/text-box-renderer.js');
    const output = document.createElement('div');
    document.body.append(output);
    renderTextBox(output, window.config);
    const size = node => getComputedStyle(node).fontSize;
    const result = {
      editor: [...window.composer.editor.querySelectorAll('[data-text-box-node]')].map(size),
      output: [...output.querySelectorAll('.text-box-token')].map(size),
      images: [...window.composer.editor.querySelectorAll('img')].map(image => getComputedStyle(image).height),
      outputImages: [...output.querySelectorAll('img')].map(image => getComputedStyle(image).height),
    };
    output.remove();
    return result;
  });
  const initial = await sizes();
  assert.equal(initial.editor[1], '64px');
  assert.deepEqual(initial.editor, initial.output);
  assert.deepEqual(initial.images, initial.outputImages);
  await page.locator('.text-box-editor').focus();
  await page.keyboard.press('Control+a');
  await page.locator('.rich-text-font-size').selectOption('40');
  const changed = await sizes();
  assert.deepEqual(changed.editor, ['40px', '40px']);
  assert.deepEqual(changed.editor, changed.output);
  assert.deepEqual(changed.images, changed.outputImages);
  await page.keyboard.press('Control+z');
  assert.deepEqual((await sizes()).editor, initial.editor);
});

test('gift chips are indivisible, removable with undo, and media inserts preserve images and kaomoji', async (t) => {
  const page = await mount(t, [{ type: 'text', text: '开头' }]);
  await selectText(page, '开头', 2, 2);
  await page.getByRole('button', { name: '礼物图片', exact: true }).click();
  await page.getByRole('button').filter({ hasText: '测试礼物' }).click();
  await page.getByRole('button', { name: '插入礼物图片', exact: true }).click();
  const chip = page.locator('.text-box-editor [data-text-box-node]');
  assert.equal((await read(page)).filter(node => node.type === 'gift').length, 1);
  await page.keyboard.insertText('后续文字');
  assert.deepEqual((await read(page)).map(node => node.type === 'text' ? node.text : node.type), ['开头', 'gift', '后续文字']);
  await chip.click();
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

test('scroll switches are exclusive and preserve long editable text', async (t) => {
  const page = await mountPreview(t);
  const editor = page.getByRole('textbox', { name: '文本框内容' });
  const horizontal = page.getByRole('switch', { name: '横向滚动' });
  const vertical = page.getByRole('switch', { name: '纵向滚动' });
  const speed = page.getByRole('slider', { name: '滚动速度', exact: true });
  const text = '第一行公告\n第二行内容'.repeat(1000);
  await editor.focus();
  await page.keyboard.press('Control+a');
  await page.evaluate(text => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    document.querySelector('.text-box-editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, text);
  await horizontal.check();
  await speed.fill('85');
  await speed.press('ArrowRight');
  assert.equal(await page.evaluate(() => window.controller.getState().draft.scrollSpeed), 86);
  await vertical.check();
  assert.equal(await page.evaluate(() => window.controller.getState().draft.scrollMode), 'vertical');
  assert.ok(await page.evaluate(text => window.controller.getState().draft.nodes.map(node => node.text || '').join('') === text, text),
    'switching playback preserves every line in the editable configuration');
  await vertical.uncheck();
  assert.equal(await page.evaluate(() => window.controller.getState().draft.scrollMode), 'none');
});

test('rapid format toggles preserve content and undo without accumulating markup', async (t) => {
  const page = await mountPreview(t);
  await page.evaluate(async () => {
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
  assert.deepEqual(await read(page), expected);
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

test('the shared font menu applies to the selection and supports undo, default font and clearing', async t => {
  const page = await mount(t, [{ type: 'text', text: '前选后', bold: true }]);
  await page.evaluate(async () => { const { enhanceSelects } = await import('/js/shared/select-menu.js'); enhanceSelects(); });
  await selectText(page, '前选后', 1, 2);
  await page.getByRole('button', { name: '文字字体', exact: true }).click();
  await page.getByRole('searchbox', { name: '文字字体：搜索', exact: true }).fill('小赖');
  await page.getByRole('option', { name: '小赖字体 · 软萌手写', exact: true }).click();
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
