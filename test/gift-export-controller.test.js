'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGiftExportController, exportLayout } = require('../src/electron/gift-export-controller');
const { registerGiftExportIpc } = require('../src/electron/ipc/gift-export-ipc');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-export-unit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let revision = 'a';
  const windows = [];
  class Window {
    constructor(options) {
      this.options = options; this.destroyed = false; windows.push(this);
      this.webContents = { setWindowOpenHandler() {}, on() {}, executeJavaScript: async () => {},
        capturePage: async (rect) => ({ toPNG() { const bytes = Buffer.alloc(24); bytes.writeUInt32BE(rect.width, 16); bytes.writeUInt32BE(rect.height, 20); return bytes; } }) };
    }
    loadURL(url) { this.url = url; return Promise.resolve(); }
    destroy() { this.destroyed = true; }
    isDestroyed() { return this.destroyed; }
  }
  const controller = createGiftExportController({ app: { getPath: () => root }, BrowserWindow: Window,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }, shell: { openPath: async () => '' },
    runtime: { getSetting: () => '', setGiftExportDirectory() {}, getGiftViewRevision: () => revision,
      prepareGiftExport: () => ({ viewRevision: revision, items: [{ eventId: 'one' }, { eventId: 'two' }], config: {}, catalog: [] }) },
    getBaseUrl: () => 'http://127.0.0.1:3000', getMainWindow: () => null });
  t.after(() => controller.dispose());
  return { root, controller, windows, stale: () => { revision = 'b'; } };
}

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
  assert.equal(windows[0].destroyed, true);
  assert.equal(windows[0].options.webPreferences.sandbox, true);
  assert.equal(windows[0].options.webPreferences.nodeIntegration, false);
  assert.equal(windows[0].url, 'http://127.0.0.1:3000/gift-export');
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
    controller: { prepare: async () => { called += 1; return {}; }, cancel() { cancelled += 1; }, dispose() {} }, getMainWindow: () => window, getDesktopBaseUrl: () => 'http://127.0.0.1:3000' });
  const invoke = handlers.get('gift-export:prepare');
  assert.equal((await invoke({ sender: contents, senderFrame: frame }, {})).ok, true);
  for (const event of [{ sender: {}, senderFrame: frame }, { sender: contents, senderFrame: { ...frame } }]) assert.equal((await invoke(event, {})).error, 'IPC_SOURCE_INVALID');
  frame.url = 'https://evil.invalid/admin';
  assert.equal((await invoke({ sender: contents, senderFrame: frame }, {})).error, 'IPC_SOURCE_INVALID');
  frame.url = 'http://127.0.0.1:3000/gift-export';
  assert.equal((await invoke({ sender: contents, senderFrame: frame }, {})).error, 'IPC_SOURCE_INVALID');
  assert.equal(called, 1);
  contents.emit('did-start-navigation', {}, '/', true, true);
  assert.equal(cancelled, 0);
  contents.emit('did-start-navigation', {}, '/', false, true);
  assert.equal(cancelled, 1);
  dispose(); assert.equal(handlers.size, 0);
  assert.equal(contents.listenerCount('did-start-navigation'), 0);
});
