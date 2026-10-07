'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

let fixture;
let browser;
test.before(async () => {
  fixture = await startComponentPreviewServer({ parentHtml: '<!doctype html><html><body><main id="host"></main></body></html>' });
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
    window.media = mountTextBoxMedia(document.querySelector('#host'), { composer: window.composer,
      onError(error) { window.failures.push(error.message); },
      async request(kind, options) {
        window.mediaCalls.push({ kind, source: options.source, name: options.file?.name });
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

test('nested styles preserve underline from ancestors and only a terminal placeholder BR is ignored', async (t) => {
  const page = await mount(t);
  const result = await page.evaluate(() => {
    window.composer.editor.innerHTML = '<span style="text-decoration:underline"><span style="color:rgb(255,0,0)">嵌套</span></span><div><br></div><div><br></div>';
    return window.readTextBoxNodes(window.composer.editor, window.config);
  });
  assert.equal(result.map(node => node.text).join(''), '嵌套\n\n');
  assert.equal(result[0].underline, true);
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
    const size = document.querySelector('.text-box-font-size');
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
