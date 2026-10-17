'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { registerScreenColorPicker } = require('../../src/electron/screen-color-picker');

function fixture(t, capture) {
  const handlers = new Map();
  const ipcMain = Object.assign(new EventEmitter(), {
    handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name),
  });
  const sender = Object.assign(new EventEmitter(), { mainFrame: { url: 'http://127.0.0.1:1234/admin' } });
  const owner = { webContents: sender, isDestroyed: () => false, focus() {} };
  const displays = [
    { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 }, size: { width: 1000, height: 800 }, scaleFactor: 1 },
    { id: 2, bounds: { x: -800, y: -100, width: 800, height: 600 }, size: { width: 800, height: 600 }, scaleFactor: 1.5 },
  ];
  const screen = Object.assign(new EventEmitter(), {
    getAllDisplays: () => displays, getDisplayNearestPoint: () => displays[1], getCursorScreenPoint: () => ({ x: -500, y: 0 }),
  });
  const windows = [];
  const crops = [];
  const sources = displays.map(display => ({ display_id: String(display.id), thumbnail: {
    isEmpty: () => false, toDataURL: () => 'data:image/png;base64,test',
    getSize: () => ({ width: display.size.width * display.scaleFactor, height: display.size.height * display.scaleFactor }),
    crop: rect => { crops.push({ id: display.id, rect }); return { toBitmap: () => Buffer.from([0x56, 0x34, 0x12, 255]) }; },
  } })).reverse();
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false;
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: {}, setWindowOpenHandler() {}, send() {},
      });
      windows.push(this);
    }
    setAlwaysOnTop() {}
    setBounds(bounds) { this.bounds = bounds; }
    getBounds() { return this.bounds; }
    async loadFile(file) { this.webContents.mainFrame.url = pathToFileURL(file).href; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    showInactive() { this.shown = true; }
    focus() { this.focused = true; }
  }
  const dispose = registerScreenColorPicker({ ipcMain, BrowserWindow: Window, screen,
    desktopCapturer: { getSources: capture || (async () => sources) },
    getMainWindow: () => owner, getDesktopBaseUrl: () => 'http://127.0.0.1:1234',
  });
  t.after(dispose);
  const event = { sender, senderFrame: sender.mainFrame };
  return { handlers, event, sender, screen, windows, crops, sources, dispose, ipcMain,
    invoke: (name, ...args) => handlers.get(`desktop:${name}`)(event, ...args),
    reply: (index, value, override = {}) => {
      const sender = windows[index].webContents;
      ipcMain.emit('screen-color-picker:reply', { sender, senderFrame: sender.mainFrame, ...override }, value);
    },
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('screen picker rejects untrusted callers, frames, paths and arguments before capture', async t => {
  let calls = 0;
  const f = fixture(t, async () => { calls++; return []; });
  for (const name of ['pick-screen-color', 'cancel-screen-color']) {
    const handler = f.handlers.get(`desktop:${name}`);
    for (const event of [{}, { ...f.event, sender: {} }, { ...f.event, senderFrame: { url: f.event.senderFrame.url } }]) {
      assert.deepEqual(await handler(event), { ok: false, error: 'IPC_SOURCE_INVALID' });
    }
    for (const url of ['https://example.com/admin', 'http://127.0.0.1:1234/license']) {
      f.sender.mainFrame.url = url;
      assert.deepEqual(await handler(f.event), { ok: false, error: 'IPC_SOURCE_INVALID' });
    }
    f.sender.mainFrame.url = 'http://127.0.0.1:1234/admin';
    assert.deepEqual(await f.invoke(name, {}), { ok: false, error: 'IPC_ARGUMENTS_INVALID' });
  }
  assert.equal(calls, 0);
});

test('screen picker maps display IDs and scaled coordinates and cleans all windows after selection', async t => {
  const f = fixture(t);
  const result = f.invoke('pick-screen-color');
  await settle();
  assert.equal(f.windows.length, 2);
  assert.deepEqual(f.windows[1].bounds, { x: -800, y: -100, width: 800, height: 600 });
  f.reply(0, { type: 'ready' });
  assert.equal(f.windows[0].shown, undefined);
  f.reply(1, { type: 'ready' });
  assert.ok(f.windows.every(window => window.shown));
  assert.ok(f.windows[1].focused);
  assert.deepEqual(await f.invoke('pick-screen-color'), { ok: false, error: 'SCREEN_COLOR_PICK_BUSY' });
  f.reply(1, { type: 'pick', x: 0.5, y: 0.25 }, { senderFrame: { url: f.windows[1].webContents.mainFrame.url } });
  for (const x of [NaN, -1, 1, Infinity]) f.reply(1, { type: 'pick', x, y: 0 });
  assert.equal(f.crops.length, 0);
  f.reply(1, { type: 'pick', x: 0.5, y: 0.25 });
  assert.deepEqual(await result, { ok: true, sRGBHex: '#123456' });
  assert.deepEqual(f.crops, [{ id: 2, rect: { x: 600, y: 225, width: 1, height: 1 } }]);
  assert.ok(f.windows.every(window => window.destroyed));
  assert.equal(f.sender.listenerCount('did-start-navigation'), 0);
  assert.equal(f.screen.listenerCount('display-removed'), 0);
});

test('cancel during capture prevents late windows from opening', async t => {
  let release;
  const f = fixture(t, () => new Promise(resolve => { release = resolve; }));
  const result = f.invoke('pick-screen-color');
  await f.invoke('cancel-screen-color');
  assert.deepEqual(await result, { ok: true, canceled: true });
  release(f.sources);
  await settle();
  assert.equal(f.windows.length, 0);
});

test('cancel, owner navigation/destruction, display changes and disposal end capture', async t => {
  for (const cancel of [
    f => f.reply(0, { type: 'cancel' }),
    f => f.sender.emit('did-start-navigation', {}, '/settings', false, true),
    f => f.sender.emit('destroyed'),
    f => f.sender.emit('render-process-gone'),
    f => f.screen.emit('display-metrics-changed'),
    f => f.windows[0].destroy(),
    f => f.dispose(),
  ]) {
    const f = fixture(t);
    const result = f.invoke('pick-screen-color');
    await settle();
    cancel(f);
    assert.deepEqual(await result, { ok: true, canceled: true });
    assert.ok(f.windows.every(window => window.destroyed));
  }
});

test('missing screen capture fails without silently selecting a different display', async t => {
  const f = fixture(t, async () => []);
  assert.deepEqual(await f.invoke('pick-screen-color'), { ok: false, error: 'SCREEN_COLOR_PICK_FAILED' });
  assert.equal(f.windows.length, 0);
});
