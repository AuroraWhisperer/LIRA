'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGiftExportController, exportLayout } = require('../../src/electron/gift-export-controller');
const { createGiftExportRuntime } = require('../../src/server/gift-export-runtime');
const { readGiftDisplaySettings } = require('../../src/bilibili/gift/display-settings');
const { registerGiftExportIpc } = require('../../src/electron/ipc/gift-export-ipc');
const { createPublicError } = require('../../src/shared/public-error');

function fixture(t, renderWidths = [856], storedSettings = {}, mergeGiftExport, capturePage) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-export-unit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let revision = 'a';
  const windows = [];
  const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };
  class Window {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.sizes = [];
      this.payloads = [];
      windows.push(this);
      let render = 0;
      this.webContents = {
        setWindowOpenHandler() {},
        on() {},
        executeJavaScript: async (script) => {
          if (script.startsWith('window.initializeGiftExport(') || script.startsWith('window.renderGiftExport(')) {
            this.payloads.push(JSON.parse(script.slice(script.indexOf('(') + 1, -1)));
          }
          return script.startsWith('window.renderGiftExport(')
            ? { width: renderWidths[Math.min(render++, renderWidths.length - 1)] }
            : undefined;
        },
        capturePage: capturePage || (async (rect) => ({
          getScaleFactors: () => [1],
          getSize: () => rect,
          toPNG() {
            const bytes = Buffer.alloc(24);
            bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
            bytes.writeUInt32BE(rect.width, 16);
            bytes.writeUInt32BE(rect.height, 20);
            return bytes;
          },
        })),
      };
    }
    loadURL(url) {
      this.url = url;
      return Promise.resolve();
    }
    setContentSize(width, height) {
      this.sizes.push({ width, height });
    }
    destroy() {
      this.destroyed = true;
    }
    isDestroyed() {
      return this.destroyed;
    }
  }
  const preferences = createGiftExportRuntime({
    getSettingsStore: () => ({ setSettings: patch => Object.assign(storedSettings, patch) }),
    giftCards: {},
  });
  const controller = createGiftExportController({
    app: { getPath: () => root },
    BrowserWindow: Window,
    dialog,
    shell: { openPath: async () => '' },
    runtime: {
      getSetting: (key) => storedSettings[key] || '',
      rememberGiftExport: preferences.rememberGiftExport,
      mergeGiftExport,
      setGiftExportSettings: preferences.setGiftExportSettings,
      getGiftViewRevision: () => revision,
      prepareGiftExport: () => ({
        viewRevision: revision,
        items: [
          { eventId: 'one', gift: { totalPrice: 2 } },
          { eventId: 'two', gift: { totalPrice: 5 } },
        ],
        config: readGiftDisplaySettings(storedSettings),
        catalog: [{ id: 'sample', name: 'Sample gift' }],
      }),
    },
    getBaseUrl: () => 'http://127.0.0.1:3000',
    getMainWindow: () => null,
  });
  t.after(() => controller.dispose());
  return {
    root,
    controller,
    windows,
    dialog,
    storedSettings,
    stale: () => {
      revision = 'b';
    },
  };
}

test('gift export hides internal errors containing Chinese paths and preserves marked business errors', async t => {
  const f = fixture(t);
  const task = await f.controller.prepare({});
  t.mock.method(fs.promises, 'mkdir', async () => { throw new Error('EIO C:\\合成用户\\礼物导出\\private.png'); });
  const result = await f.controller.save({ id: task.id });
  assert.equal(result.ok, false);
  assert.equal(result.error.includes('private.png'), false);
  assert.equal(result.error.includes('合成用户'), false);

  const handlers = new Map();
  const frame = { url: 'http://127.0.0.1:3000/admin' };
  const contents = new (require('node:events').EventEmitter)();
  contents.mainFrame = frame;
  let failure = new Error('EIO C:\\合成用户\\private.png');
  const dispose = registerGiftExportIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler() {} },
    controller: { prepare: async () => { throw failure; }, cancel() {}, dispose() {} },
    getMainWindow: () => ({ webContents: contents, isDestroyed: () => false }),
    getDesktopBaseUrl: () => 'http://127.0.0.1:3000',
  });
  t.after(dispose);
  const invoke = () => handlers.get('gift-export:prepare')({ sender: contents, senderFrame: frame }, {});
  assert.equal((await invoke()).error.includes('private.png'), false);
  failure = createPublicError('请选择礼物记录。');
  assert.equal((await invoke()).error, failure.publicMessage);
});

test('gift export rejects empty or malformed capture output without writing a partial PNG', async t => {
  for (const [scaleFactor, bytes] of [[1, Buffer.alloc(0)], [2, Buffer.alloc(24)]]) {
    const f = fixture(t, [856], {}, undefined, async rect => ({
      getScaleFactors: () => [scaleFactor],
      getSize: () => rect,
      toBitmap: () => Buffer.alloc(0),
      toPNG: () => bytes,
    }));
    const task = await f.controller.prepare({});
    const result = await f.controller.save({ id: task.id });
    assert.equal(result.ok, false);
    assert.equal(result.saved, 0);
    assert.match(result.error, /尺寸/);
    assert.deepEqual(fs.readdirSync(task.directory), []);
    assert.equal(f.windows[0].destroyed, true);
  }
});

test('a transient compositor failure retries the current image once without duplicating earlier files', async t => {
  for (const failures of [1, 2]) {
    const { controller, windows } = fixture(t);
    const { id } = await controller.prepare({});
    await controller.configure({ id, mode: 'separate', background: 'transparent' });
    const result = await controller.save({ id }, ({ saved }) => {
      if (saved === 1) t.mock.method(windows[0].webContents, 'capturePage', async () => {
        throw new Error('UnknownVizError');
      }, { times: failures });
    });
    assert.equal(result.ok, failures === 1);
    assert.equal(result.saved, failures === 1 ? 2 : 1);
    assert.equal(fs.readdirSync(result.directory).length, result.saved);
  }
});

test('export settings work without a selection, persist and only affect new tasks', async (t) => {
  const { root, controller, storedSettings, dialog } = fixture(t);
  assert.deepEqual(await controller.settings(), {
    mode: 'combined',
    background: 'transparent',
    sortBy: 'time',
    rowGap: 16,
    mergeAcrossDates: false,
    directory: path.join(root, 'LIRA', '礼物导出'),
    custom: false,
  });
  const directory = path.join(root, 'chosen');
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  await controller.settings({ mode: 'separate', background: 'white', sortBy: 'amount', rowGap: 0, directoryAction: 'choose' });
  assert.equal(fs.existsSync(directory), false);
  const reloaded = fixture(t, undefined, storedSettings);
  const task = await reloaded.controller.prepare({});
  assert.equal(task.mode, 'separate');
  assert.equal(task.background, 'white');
  assert.deepEqual(task.snapshot.items.map(item => item.eventId), ['two', 'one']);
  assert.equal(task.rowGap, 0);
  assert.equal(task.root, directory);
  await reloaded.controller.settings({ mode: 'combined', background: 'transparent', directoryAction: 'default' });
  assert.equal((await reloaded.controller.save({ id: task.id })).saved, 2);
  assert.equal(fs.readdirSync(task.directory).length, 2);
  const next = await reloaded.controller.prepare({});
  assert.equal(next.mode, 'combined');
  assert.equal(next.background, 'transparent');
  assert.equal(next.root, path.join(reloaded.root, 'LIRA', '礼物导出'));
});

test('custom PNG style is seeded once and follows its own saved preference across tasks', async t => {
  const rolling = { ...readGiftDisplaySettings({}), tailStyle: 'swallowtail', textureStyle: 'satin', sheen: true };
  const stored = { giftDisplayConfig: JSON.stringify(rolling) };
  const { controller, windows } = fixture(t, undefined, stored, async snapshot => {
    assert.equal(snapshot.config.tailStyle, rolling.tailStyle);
    return { ...snapshot, items: snapshot.items.slice(1) };
  });
  const task = await controller.prepare({});
  assert.equal(task.styleSource, 'follow');
  const options = { id: task.id, mode: task.mode, background: task.background, remember: true };
  const first = await controller.configure({ ...options, styleSource: 'custom' });
  assert.equal(first.snapshot.config.tailStyle, rolling.tailStyle);
  assert.equal(first.snapshot.config.textureStyle, rolling.textureStyle);
  const customStyle = { tailStyle: 'capsule', textureStyle: 'lace', thresholds: [250, 1250, 2500] };
  await controller.configure({ ...options, customStyle });
  const grouped = await controller.configure({ ...options, sortBy: 'amount', mergeAcrossDates: true });
  assert.equal(grouped.snapshot.config.textureStyle, 'lace');
  assert.deepEqual(grouped.snapshot.config.thresholds, customStyle.thresholds);
  assert.equal((await controller.save(options)).ok, true);
  assert.equal(windows[0].payloads[0].config.tailStyle, 'capsule');
  assert.deepEqual(windows[0].payloads[0].config.thresholds, grouped.snapshot.config.thresholds);
  assert.equal(windows[0].payloads[0].config.sheen, false);
  assert.equal(stored.giftDisplayConfig, JSON.stringify(rolling));
  const reopened = await controller.prepare({});
  assert.equal(reopened.styleSource, 'custom');
  const followed = await controller.configure({ ...options, id: reopened.id, styleSource: 'follow' });
  assert.equal(followed.snapshot.config.tailStyle, rolling.tailStyle);
  stored.giftDisplayConfig = JSON.stringify({ ...rolling, tailStyle: 'ribbon' });
  const next = await controller.prepare({});
  assert.equal(next.styleSource, 'follow');
  assert.equal(next.snapshot.config.tailStyle, 'ribbon');
  const restored = await controller.configure({ ...options, id: next.id, styleSource: 'custom' });
  assert.equal(restored.snapshot.config.tailStyle, 'capsule');
  assert.deepEqual(restored.snapshot.config.thresholds, customStyle.thresholds);
});

test('export rejects invalid or live-only style fields without replacing the saved preference', async t => {
  const { controller, storedSettings } = fixture(t);
  const task = await controller.prepare({});
  const options = { id: task.id, mode: task.mode, background: task.background, styleSource: 'custom', remember: true };
  await controller.configure(options);
  const previous = storedSettings.giftExportStyle;
  const style = JSON.parse(previous).customStyle;
  for (const patch of [{ thresholds: [200, 200, 300] }, { textureStyle: 'unknown' }, { sheen: true }]) {
    await assert.rejects(controller.configure({ ...options, customStyle: { ...style, ...patch } }));
  }
  await assert.rejects(controller.configure({ ...options, styleSource: 'follow', customStyle: style }));
  assert.equal(storedSettings.giftExportStyle, previous);
  storedSettings.giftExportStyle = '{}';
  assert.equal((await controller.prepare({})).styleSource, 'follow');
});

test('export settings reject unsafe values and discard cancelled or stale directory dialogs', async (t) => {
  const { controller, dialog, storedSettings } = fixture(t);
  for (const input of [
    null,
    [],
    { root: 'C:/arbitrary' },
    { directory: 'C:/arbitrary' },
    { mode: 'huge' },
    { background: 'red' },
    { sortBy: 'name' },
    { rowGap: -1 },
    { rowGap: 33 },
    { rowGap: '0' },
    { mergeAcrossDates: 'false' },
    { directoryAction: 'write' },
  ]) {
    await assert.rejects(() => controller.settings(input));
  }
  await controller.settings({ directoryAction: 'choose', mode: 'separate' });
  assert.deepEqual(storedSettings, {});
  let finish;
  dialog.showOpenDialog = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pending = controller.settings({ directoryAction: 'choose' });
  controller.cancel();
  finish({ canceled: false, filePaths: ['C:/discarded'] });
  await assert.rejects(pending, /取消/);
  assert.deepEqual(storedSettings, {});
});

test('export preview creates no files and accepts only dialog/system directories and bounded output', async (t) => {
  const { root, controller, storedSettings } = fixture(t);
  const task = await controller.prepare({});
  assert.equal(fs.existsSync(task.directory), false);
  const configured = await controller.configure({
    id: task.id,
    mode: 'separate',
    background: 'white',
    directoryAction: 'choose',
    remember: true,
    root: 'C:/arbitrary',
  });
  assert.equal(configured.root, path.join(root, 'LIRA', '礼物导出'));
  assert.equal(configured.directory, task.directory);
  assert.equal(configured.files.length, 2);
  assert.equal(configured.background, 'white');
  assert.equal(storedSettings.giftExportDirectory, undefined);
  await assert.rejects(() => controller.configure({ id: task.id, mode: 'huge', background: 'white' }));
  await assert.rejects(() => controller.configure({ id: task.id, mode: 'combined', background: 'white', rowGap: 0.5 }));
  await assert.rejects(() => controller.configure({ id: task.id, mode: 'combined', background: 'white', sortBy: 'name' }));
  assert.deepEqual(exportLayout(50, 'combined', 32).map(file => file.count), [50]);
  assert.deepEqual(exportLayout(51, 'combined', 0).map(file => file.count), [50, 1]);
  assert.throws(() => exportLayout(10001, 'combined'));
});

test('amount order uses merged settlements before pagination and time order restores the snapshot', async t => {
  const { controller, windows } = fixture(t, undefined, {}, async snapshot => ({
    ...snapshot,
    items: [
      { eventId: 'recent', gift: { totalPrice: 6 } },
      { eventId: 'tie', gift: { totalPrice: 6 } },
      { eventId: 'merged', gift: { totalPrice: 1 }, settledTotalCents: '700' },
    ],
  }));
  const { id } = await controller.prepare({});
  const options = { id, mode: 'separate', background: 'white', mergeAcrossDates: true };
  const ids = (task) => task.snapshot.items.map(item => item.eventId);
  const amount = await controller.configure({ ...options, sortBy: 'amount' });
  assert.deepEqual(ids(amount), ['merged', 'recent', 'tie']);
  assert.equal((await controller.save({ id })).saved, 3);
  assert.deepEqual(windows[0].payloads.slice(1).map(payload => payload.items[0].eventId), ids(amount));
  assert.deepEqual(ids(await controller.configure({ ...options, sortBy: 'time' })), ['recent', 'tie', 'merged']);
});

test('the export reuses frozen groupings when toggled and saves the previewed cards', async (t) => {
  let requests = 0;
  const { controller, windows } = fixture(t, undefined, {}, async (snapshot) => {
    requests++;
    return { ...snapshot, items: [snapshot.items[0]] };
  });
  const task = await controller.prepare({});
  const options = { id: task.id, mode: 'separate', background: 'white' };
  await assert.rejects(controller.configure({ ...options, mode: 'invalid', mergeAcrossDates: true }));
  assert.equal(requests, 0);
  const grouped = await controller.configure({ ...options, mergeAcrossDates: true });
  assert.equal(grouped.files.length, 1);
  assert.equal((await controller.configure({ ...options, mergeAcrossDates: false })).files.length, 2);
  await controller.configure({ ...options, mergeAcrossDates: true });
  assert.equal(requests, 1);
  assert.equal((await controller.save({ id: task.id })).saved, 1);
  assert.deepEqual(windows[0].payloads.at(-1).items, grouped.snapshot.items);
  await controller.settings({ mergeAcrossDates: true });
  assert.equal((await controller.prepare({})).snapshot.items.length, 1);
  assert.equal(requests, 2);
});

test('a pending group lookup cannot be saved or applied after the export closes', async (t) => {
  const lookup = Promise.withResolvers();
  let requestSignal;
  const { controller } = fixture(t, undefined, {}, async (snapshot, signal) => {
    requestSignal = signal;
    await lookup.promise;
    return snapshot;
  });
  const task = await controller.prepare({});
  const pending = controller.configure({ id: task.id, mode: task.mode, background: task.background, mergeAcrossDates: true });
  await assert.rejects(controller.save({ id: task.id }));
  controller.cancel(task.id);
  assert.equal(requestSignal.aborted, true);
  lookup.resolve();
  await assert.rejects(pending);
});

test('cancelling a batch keeps exactly saved files and destroys its sandboxed render window', async (t) => {
  const { controller, windows } = fixture(t);
  const task = await controller.prepare({});
  await controller.configure({ id: task.id, mode: 'separate', background: 'transparent' });
  const result = await controller.save({ id: task.id }, () => controller.cancel(task.id));
  assert.equal(result.cancelled, true);
  assert.equal(result.saved, 1);
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
  assert.deepEqual(windows[0].sizes, [
    { width: 1400, height: 144 },
    { width: 856, height: 144 },
  ]);
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

test('export transfers the fixed catalog once across separate images', async (t) => {
  const { controller, windows } = fixture(t);
  const task = await controller.prepare({});
  await controller.configure({ id: task.id, mode: 'separate', background: 'transparent' });
  const result = await controller.save({ id: task.id });
  assert.equal(result.ok, true);
  assert.equal(result.saved, 2);
  assert.equal(windows[0].payloads.reduce((count, payload) => count + (payload.catalog?.length || 0), 0), 1);
});

test('a source change prevents any subsequent file being written', async (t) => {
  const { controller, stale } = fixture(t);
  const task = await controller.prepare({});
  await controller.configure({ id: task.id, mode: 'separate', background: 'white' });
  const result = await controller.save({ id: task.id }, stale);
  assert.equal(result.ok, false);
  assert.equal(result.saved, 1);
  assert.match(result.error, /来源/);
});

test('reconfiguring a partially failed export allocates a new directory and keeps the first batch', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-25T16:07:58Z'));
  const widths = [856, 9000];
  const { controller } = fixture(t, widths);
  const task = await controller.prepare({});
  assert.equal(task.directory, path.join(task.root, '2026-11-26', '0007'));
  const options = { id: task.id, mode: 'separate', background: 'transparent' };
  const cancelPicker = () => controller.configure({ ...options, directoryAction: 'choose' });
  await controller.configure(options);
  const failed = await controller.save({ id: task.id });
  assert.equal(failed.ok, false);
  assert.equal(failed.saved, 1);
  assert.equal((await cancelPicker()).directory, task.directory);
  assert.equal((await controller.openFolder({ id: task.id })).ok, true);
  const next = await controller.configure(options);
  assert.equal(next.directory, `${task.directory}-02`);
  assert.deepEqual(fs.readdirSync(task.directory), ['礼物_001.png']);
  widths[1] = 856;
  const retried = await controller.save({ id: task.id });
  assert.equal(retried.ok, true);
  assert.equal(retried.saved, 2);
  assert.equal((await cancelPicker()).directory, next.directory);
  await assert.rejects(controller.save({ id: task.id }));
  assert.equal((await controller.openFolder({ id: task.id })).ok, true);
  const changed = await controller.configure({ ...options, background: 'white', directoryAction: 'choose' });
  assert.equal(changed.background, 'white');
  assert.equal(changed.root, next.root);
  assert.equal(changed.directory, `${task.directory}-03`);
  await assert.rejects(controller.openFolder({ id: task.id }));
  assert.deepEqual(fs.readdirSync(next.directory), ['礼物_001.png', '礼物_002.png']);
  assert.deepEqual(fs.readdirSync(task.directory), ['礼物_001.png']);
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

test('a partial disk write removes only the failed PNG and keeps the completed batch prefix', async t => {
  const { controller } = fixture(t);
  const task = await controller.prepare({});
  await controller.configure({ id: task.id, mode: 'separate', background: 'transparent' });
  const open = fs.promises.open;
  t.mock.method(fs.promises, 'open', async (filename, flags) => {
    const handle = await open(filename, flags);
    if (filename.endsWith('_002.png')) {
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async bytes => {
        await write(bytes.subarray(0, 8));
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      };
    }
    return handle;
  });
  const result = await controller.save({ id: task.id });
  assert.equal(result.ok, false);
  assert.equal(result.saved, 1);
  assert.deepEqual(fs.readdirSync(task.directory), ['礼物_001.png']);
});

test('closing a preview rejects its in-flight preparation', async (t) => {
  const { controller } = fixture(t);
  const pending = controller.prepare({});
  controller.cancel();
  await assert.rejects(pending, /取消/);
});

test('export channels use the shared source policy and cancel only when their owner navigates', async () => {
  const handlers = new Map();
  const frame = { url: 'http://127.0.0.1:3000/admin' };
  const contents = Object.assign(new (require('node:events').EventEmitter)(), { mainFrame: frame });
  const window = { isDestroyed: () => false, webContents: contents };
  let called = 0;
  let cancelled = 0;
  const dispose = registerGiftExportIpc({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: (name) => handlers.delete(name) },
    controller: {
      prepare: async () => {
        called += 1;
        return {};
      },
      settings: async () => {
        called += 1;
        return {};
      },
      cancel() {
        cancelled += 1;
      },
      dispose() {},
    },
    getMainWindow: () => window,
    getDesktopBaseUrl: () => 'http://127.0.0.1:3000',
  });
  // The registrar owns the origin/frame matrix; every consumer channel must use it.
  for (const [channel, invoke] of handlers) {
    assert.equal((await invoke(undefined, {})).error, 'IPC_SOURCE_INVALID', channel);
  }
  assert.equal(called, 0);
  for (const channel of ['prepare', 'settings']) {
    const invoke = handlers.get(`gift-export:${channel}`);
    assert.equal((await invoke({ sender: contents, senderFrame: frame }, {})).ok, true);
  }
  for (const page of ['license', 'gift-export']) {
    frame.url = `http://127.0.0.1:3000/${page}`;
    assert.equal((await handlers.get('gift-export:prepare')({ sender: contents, senderFrame: frame }, {})).error,
      'IPC_SOURCE_INVALID', page);
  }
  assert.equal(called, 2);
  contents.emit('did-start-navigation', {}, '/', true, true);
  assert.equal(cancelled, 0);
  contents.emit('did-start-navigation', {}, '/', false, true);
  assert.equal(cancelled, 1);
  dispose();
  assert.equal(handlers.size, 0);
  assert.equal(contents.listenerCount('did-start-navigation'), 0);
});
