'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createComponentWebPicker, componentWebDirectory } = require('../../src/electron/component-web-picker');
const { createComponentWebLibrary } = require('../../src/server/component-web-library');
const { createComponentStyleStore } = require('../../src/storage/component-style-store');

function fixture(t, entries) {
  const temporary = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(temporary, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporary, 'component-web-picker-'));
  for (const [name, value] of entries) {
    const filename = path.join(root, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, value);
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

async function collect(files) {
  const result = new Map();
  for await (const file of files) {
    const chunks = [];
    for await (const chunk of file.stream) chunks.push(chunk);
    result.set(file.path, Buffer.concat(chunks));
  }
  return result;
}

function pickerFor(selected) {
  return createComponentWebPicker({ dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [selected] }) }, getWindow: () => null });
}

test('native HTML selection imports companion directories without exposing absolute paths to the renderer', async t => {
  const binary = Buffer.from([0, 255, 10, 23, 0]);
  const entries = [
    ['index.html', '<link href="css/style.css"><script src="js/clock.js"></script>'],
    ['css/style.css', 'body { background: url("../images/frame.png"); }'],
    ['js/clock.js', 'document.body.dataset.loaded = "yes";'], ['images/frame.png', binary],
    ['fonts/clock.woff2', binary], ['config.json', '{"room":1}'],
    ['data/config.json', '{"clock":true}'], ['storage/fonts/clock.woff2', binary],
    ['README.md', 'How to install'], ['setup.exe', 'Not a web resource'], ['.env', 'Not a web resource'],
    ['.hidden/private.js', 'private'], ['node_modules/tool/index.js', 'private'],
    ['package.json', '{}'], ['package-lock.json', '{}'], ['tsconfig.json', '{}'],
  ];
  const root = fixture(t, entries);
  const window = { id: 'synthetic-owner-window' };
  const picker = createComponentWebPicker({ getWindow: () => window, dialog: {
    async showOpenDialog(parent, options) {
      assert.equal(parent, window);
      assert.deepEqual(options.properties, ['openFile']);
      assert.deepEqual(options.filters[0].extensions, ['html', 'htm']);
      return { canceled: false, filePaths: [path.join(root, 'index.html')] };
    },
  } });
  const selected = await picker('html');
  assert.deepEqual(Object.keys(selected).sort(), ['entry', 'files']);
  assert.equal(selected.entry, 'index.html');
  const imported = await collect(selected.files);
  assert.deepEqual([...imported.keys()].sort(), entries.slice(0, 8).map(([name]) => name).sort());
  for (const [name, value] of entries.slice(0, 8)) assert.deepEqual(imported.get(name), Buffer.isBuffer(value) ? value : Buffer.from(value));
});

test('choosing a CSS file in a subdirectory preserves sibling resources and the entry path', async t => {
  const root = fixture(t, [
    ['skin/css/style.css', '@import "palette.css"; .danmaku-content { background: url("../images/frame.png"); }'],
    ['skin/css/palette.css', '@font-face { font-family: clock; src: url("../fonts/clock.woff2"); }'],
    ['skin/images/frame.png', Buffer.from([1, 2, 3])], ['skin/fonts/clock.woff2', Buffer.from([4, 5, 6])],
    ['unrelated/private.json', '{"private":true}'],
  ]);
  const selected = await pickerFor(path.join(root, 'skin', 'css', 'style.css'))('auto');
  assert.equal(selected.entry, 'css/style.css');
  const dataDir = path.join(root, 'isolated-library');
  const imported = await createComponentWebLibrary(dataDir).add(selected.files,
    { type: 'danmaku', entry: selected.entry, width: 400, height: 600 }, () => {});
  assert.equal(imported.styles[0].config.cssStyle.engine, 'blc');
  assert.match(imported.styles[0].config.cssStyle.src, /\/css\/style\.css$/);
  const directory = path.join(createComponentStyleStore(dataDir).directory(imported.id), 'web');
  assert.deepEqual(fs.readFileSync(path.join(directory, 'images', 'frame.png')), Buffer.from([1, 2, 3]));
  assert.deepEqual(fs.readFileSync(path.join(directory, 'fonts', 'clock.woff2')), Buffer.from([4, 5, 6]));
  assert.equal(fs.existsSync(path.join(directory, 'unrelated')), false);
});

test('automatic selection returns only the selected media or archive and delays opening until authorized', async t => {
  const bytes = Buffer.from([0, 255, 10, 23]);
  const root = fixture(t, [['图片.webp', bytes], ['样式.zip', bytes], ['clip.mp4', bytes], ['private.json', '{}']]);
  for (const name of ['图片.webp', '样式.zip', 'clip.mp4']) {
    const selected = await pickerFor(path.join(root, name))('auto');
    assert.deepEqual(Object.keys(selected).sort(), ['name', 'open', 'size']);
    assert.equal(selected.name, name);
    assert.equal(selected.size, bytes.length);
    const chunks = [];
    for await (const chunk of selected.open()) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), bytes);
  }
  await assert.rejects(pickerFor(path.join(root, 'private.json'))('auto'), { statusCode: 400 });
});

test('canceling, empty selection and dialog failure release the native chooser', async () => {
  const results = [{ canceled: true, filePaths: ['/must/not/be/read.html'] }, { canceled: false, filePaths: [] }, new Error('Dialog unavailable'), { canceled: true }];
  const picker = createComponentWebPicker({ getWindow: () => null, dialog: {
    async showOpenDialog(_parent, options) {
      assert.deepEqual(options.filters[0].extensions, ['css']);
      const result = results.shift();
      if (result instanceof Error) throw result;
      return result;
    },
  } });
  assert.equal(await picker('css'), null);
  assert.equal(await picker('css'), null);
  await assert.rejects(picker('css'), /Dialog unavailable/);
  assert.equal(await picker('css'), null);
});

test('the native chooser rejects unsupported kinds and a second request while already open', async () => {
  const selected = Promise.withResolvers();
  let calls = 0;
  const picker = createComponentWebPicker({ getWindow: () => null, dialog: {
    showOpenDialog() { calls++; return selected.promise; },
  } });
  await assert.rejects(picker('directory'), { statusCode: 400 });
  assert.equal(calls, 0);
  const first = picker('html');
  await assert.rejects(picker('css'), { statusCode: 400 });
  assert.equal(calls, 1);
  selected.resolve({ canceled: true });
  assert.equal(await first, null);
  assert.equal(await picker('html'), null);
  assert.equal(calls, 2);
});

test('selected directory junctions are rejected and nested junctions are excluded from companion files', async t => {
  const root = fixture(t, [['bundle/index.html', '<h1>Clock</h1>'], ['outside/private.json', '{"private":true}']]);
  fs.symlinkSync(path.join(root, 'bundle'), path.join(root, 'linked-bundle'), 'junction');
  await assert.rejects(pickerFor(path.join(root, 'linked-bundle', 'index.html'))('html'), { statusCode: 400 });
  fs.symlinkSync(path.join(root, 'outside'), path.join(root, 'bundle', 'linked'), 'junction');
  const selected = await pickerFor(path.join(root, 'bundle', 'index.html'))('html');
  assert.deepEqual([...await collect(selected.files)].map(([name]) => name), ['index.html']);
});

test('native selection never imports an entire personal folder when chosen directly or by expansion', async t => {
  const root = fixture(t, [
    ['Downloads/index.html', '<h1>Clock</h1>'],
    ['Downloads/skin/style.css', 'body { background-image: url("../frame.png"); }'],
    ['Downloads/frame.png', 'image'],
  ]);
  await assert.rejects(pickerFor(path.join(root, 'Downloads', 'index.html'))('html'), { statusCode: 400 });
  await assert.rejects(pickerFor(path.join(root, 'Downloads', 'skin', 'style.css'))('css'), { statusCode: 400 });
});

test('companion traversal stops at the supported nesting depth', async t => {
  const nested = `${Array.from({ length: 17 }, (_, index) => `level-${index}`).join('/')}/image.png`;
  const root = fixture(t, [['index.html', '<h1>Clock</h1>'], [nested, 'image']]);
  await assert.rejects(collect(componentWebDirectory(root)), { statusCode: 400 });
});
