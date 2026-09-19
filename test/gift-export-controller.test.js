'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGiftExportController, exportLayout } = require('../src/electron/gift-export-controller');
const { registerGiftExportIpc } = require('../src/electron/ipc/gift-export-ipc');

function fixture(t, renderWidths = [856], storedSettings = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-export-unit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let revision = 'a';
  const windows = [];
  const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };
  class Window {
    constructor(options) {
      this.options = options; this.destroyed = false; this.sizes = []; windows.push(this);
      let render = 0;
      this.webContents = { setWindowOpenHandler() {}, on() {},
        executeJavaScript: async (script) => script.startsWith('window.renderGiftExport(')
          ? { width: renderWidths[Math.min(render++, renderWidths.length - 1)] } : undefined,
        capturePage: async (rect) => ({ toPNG() { const bytes = Buffer.alloc(24); bytes.writeUInt32BE(rect.width, 16); bytes.writeUInt32BE(rect.height, 20); return bytes; } }) };
    }
    loadURL(url) { this.url = url; return Promise.resolve(); }
    setContentSize(width, height) { this.sizes.push({ width, height }); }
    destroy() { this.destroyed = true; }
    isDestroyed() { return this.destroyed; }
  }
  const controller = createGiftExportController({ app: { getPath: () => root }, BrowserWindow: Window,
    dialog, shell: { openPath: async () => '' },
    runtime: { getSetting: (key) => storedSettings[key] || '',
      setGiftExportDirectory: (directory) => { storedSettings.giftExportDirectory = directory; },
      setGiftExportSettings: ({ mode, background, directory }) => Object.assign(storedSettings, {
        giftExportMode: mode, giftExportBackground: background, giftExportDirectory: directory,
      }), getGiftViewRevision: () => revision,
      prepareGiftExport: () => ({ viewRevision: revision, items: [{ eventId: 'one' }, { eventId: 'two' }], config: {}, catalog: [] }) },
    getBaseUrl: () => 'http://127.0.0.1:3000', getMainWindow: () => null });
  t.after(() => controller.dispose());
  return { root, controller, windows, dialog, storedSettings, stale: () => { revision = 'b'; } };
}

test('export settings work without a selection, persist and only affect new tasks', async (t) => {
  const { root, controller, storedSettings, dialog } = fixture(t);
  assert.deepEqual(await controller.settings(), {
    mode: 'combined', background: 'transparent', directory: path.join(root, 'LIRA', '礼物导出'), custom: false,
  });
  const directory = path.join(root, 'chosen');
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  await controller.settings({ mode: 'separate', background: 'white', directoryAction: 'choose' });
  assert.equal(fs.existsSync(directory), false);
  const reloaded = fixture(t, undefined, storedSettings);
  const task = await reloaded.controller.prepare({});
  assert.equal(task.mode, 'separate');
  assert.equal(task.background, 'white');
  assert.equal(task.root, directory);
  await reloaded.controller.settings({ mode: 'combined', background: 'transparent', directoryAction: 'default' });
  assert.equal((await reloaded.controller.save({ id: task.id })).saved, 2);
  assert.equal(fs.readdirSync(task.directory).length, 2);
  const next = await reloaded.controller.prepare({});
  assert.equal(next.mode, 'combined');
  assert.equal(next.background, 'transparent');
  assert.equal(next.root, path.join(reloaded.root, 'LIRA', '礼物导出'));
});

test('export settings reject unsafe values and discard cancelled or stale directory dialogs', async (t) => {
  const { controller, dialog, storedSettings } = fixture(t);
  for (const input of [null, [], { root: 'C:/arbitrary' }, { directory: 'C:/arbitrary' },
    { mode: 'huge' }, { background: 'red' }, { directoryAction: 'write' }]) {
    await assert.rejects(() => controller.settings(input));
  }
  await controller.settings({ directoryAction: 'choose', mode: 'separate' });
  assert.deepEqual(storedSettings, {});
  let finish;
  dialog.showOpenDialog = () => new Promise((resolve) => { finish = resolve; });
  const pending = controller.settings({ directoryAction: 'choose' });
  controller.cancel();
  finish({ canceled: false, filePaths: ['C:/discarded'] });
  await assert.rejects(pending, /取消/);
  assert.deepEqual(storedSettings, {});
});

test('export preview creates no files and accepts only dialog/system directories and bounded output', async (t) => {
  const { root, controller } = fixture(t);
  const task = await controller.prepare({});
  assert.equal(fs.existsSync(task.directory), false);
  const configured = await controller.configure({ id: task.id, mode: 'separate', background: 'transparent', directoryAction: 'choose', root: 'C:/arbitrary' });
  assert.equal(configured.root, path.join(root, 'LIRA', '礼物导出'));
  assert.equal(configured.directory, task.directory);
  await assert.rejects(() => controller.configure({ id: task.id, mode: 'huge', background: 'white' }));
  assert.equal(exportLayout(40, 'combined').length, 2);
  assert.throws(() => exportLayout(10001, 'combined'));
});

test('cancelling a batch keeps exactly saved files and destroys its sandboxed render window', async (t) => {
  const { controller, windows } = fixture(t);
  const task = await controller.prepare({});
  await controller.configure({ id: task.id, mode: 'separate', background: 'transparent' });
  const result = await controller.save({ id: task.id }, () => controller.cancel(task.id));
  assert.equal(result.cancelled, true); assert.equal(result.saved, 1);
  assert.deepEqual(fs.readdirSync(task.directory), ['礼物_001.png']);
  const png = fs.readFileSync(path.join(task.directory, '礼物_001.png'));
  assert.equal(png.readUInt32BE(16), 856);
  assert.equal(png.readUInt32BE(20), 144);
  assert.equal(windows[0].options.width, 856);
  assert.equal(windows[0].destroyed, true);
  assert.equal(windows[0].options.webPreferences.sandbox, true);
  assert.equal(windows[0].options.webPreferences.nodeIntegration, false);
  assert.equal(windows[0].url, 'http://127.0.0.1:3000/gift-export');
});

test('export resizes each PNG to its rendered quantity width and rejects invalid dimensions', async (t) => {
  const { controller, windows } = fixture(t, [1400, 856]);
  const task = await controller.prepare({});
  await controller.configure({ id: task.id, mode: 'separate', background: 'transparent' });
  const result = await controller.save({ id: task.id });
  assert.equal(result.ok, true);
  assert.equal(result.saved, 2);
  assert.deepEqual(windows[0].sizes, [{ width: 1400, height: 144 }, { width: 856, height: 144 }]);
  assert.equal(fs.readFileSync(path.join(task.directory, '礼物_001.png')).readUInt32BE(16), 1400);
  assert.equal(fs.readFileSync(path.join(task.directory, '礼物_002.png')).readUInt32BE(16), 856);
  assert.equal(windows[0].destroyed, true);
  for (const width of [855, 856.5, 9000]) {
    const invalid = fixture(t, [width]);
    const next = await invalid.controller.prepare({});
    const failed = await invalid.controller.save({ id: next.id });
    assert.equal(failed.ok, false);
    assert.equal(failed.saved, 0);
    assert.match(failed.error, /尺寸/);
    assert.equal(invalid.windows[0].destroyed, true);
    assert.deepEqual(fs.readdirSync(next.directory), []);
  }
});

test('a source change prevents any subsequent file being written', async (t) => {
  const { controller, stale } = fixture(t);
  const task = await controller.prepare({});
  await controller.configure({ id: task.id, mode: 'separate', background: 'white' });
  const result = await controller.save({ id: task.id }, stale);
  assert.equal(result.ok, false); assert.equal(result.saved, 1);
  assert.match(result.error, /来源/);
});

test('a conflicting output directory reports failure without overwriting or claiming saved files', async (t) => {
  const { controller, windows } = fixture(t);
  const task = await controller.prepare({});
  fs.mkdirSync(task.directory, { recursive: true });
  fs.writeFileSync(path.join(task.directory, 'keep.txt'), 'existing');
  const result = await controller.save({ id: task.id });
  assert.equal(result.ok, false);
  assert.equal(result.saved, 0);
  assert.match(result.error, /保存位置不可用/);
  assert.equal(windows.length, 0);
  assert.deepEqual(fs.readdirSync(task.directory), ['keep.txt']);
});

test('closing a preview rejects its in-flight preparation', async (t) => {
  const { controller } = fixture(t);
  const pending = controller.prepare({});
  controller.cancel();
  await assert.rejects(pending, /取消/);
});

test('export IPC rejects remote pages, secondary windows and child frames', async () => {
  const handlers = new Map();
  const frame = { url: 'http://127.0.0.1:3000/admin' };
  const contents = Object.assign(new (require('node:events').EventEmitter)(), { mainFrame: frame });
  const window = { isDestroyed: () => false, webContents: contents };
  let called = 0;
  let cancelled = 0;
  const dispose = registerGiftExportIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: (name) => handlers.delete(name) },
    controller: { prepare: async () => { called += 1; return {}; }, settings: async () => { called += 1; return {}; }, cancel() { cancelled += 1; }, dispose() {} }, getMainWindow: () => window, getDesktopBaseUrl: () => 'http://127.0.0.1:3000' });
  for (const channel of ['prepare', 'settings']) {
    const invoke = handlers.get(`gift-export:${channel}`);
    frame.url = 'http://127.0.0.1:3000/admin';
    assert.equal((await invoke({ sender: contents, senderFrame: frame }, {})).ok, true);
    for (const event of [{ sender: {}, senderFrame: frame }, { sender: contents, senderFrame: { ...frame } }]) assert.equal((await invoke(event, {})).error, 'IPC_SOURCE_INVALID');
    frame.url = 'https://evil.invalid/admin';
    assert.equal((await invoke({ sender: contents, senderFrame: frame }, {})).error, 'IPC_SOURCE_INVALID');
    frame.url = 'http://127.0.0.1:3000/gift-export';
    assert.equal((await invoke({ sender: contents, senderFrame: frame }, {})).error, 'IPC_SOURCE_INVALID');
  }
  assert.equal(called, 2);
  contents.emit('did-start-navigation', {}, '/', true, true);
  assert.equal(cancelled, 0);
  contents.emit('did-start-navigation', {}, '/', false, true);
  assert.equal(cancelled, 1);
  dispose(); assert.equal(handlers.size, 0);
  assert.equal(contents.listenerCount('did-start-navigation'), 0);
});
