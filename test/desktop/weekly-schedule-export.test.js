'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createWeeklyScheduleExportController, validateWeeklyScheduleExportTemplate } =
  require('../../src/electron/weekly-schedule-export-controller');
const { registerWeeklyScheduleIpc } = require('../../src/electron/ipc/weekly-schedule-ipc');
const { servePageOrAsset } = require('../../src/server/page-assets');

const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const BASE_URL = 'http://127.0.0.1:31001';

function png(width = 1920, height = 1080) {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function template() {
  return {
    name: '测试模板', title: 'Schedule', weekLabel: '每周日程', streamerName: '测试/主播',
    monday: '2026-11-09', layout: 'scrapbook', fontId: 'Microsoft YaHei',
    primaryColor: '#f8d66d', accentColor: '#875633', assets: {},
    portrait: { scale: 100, x: 0, y: 0 }, logo: { scale: 100, x: 0, y: 0 }, chibi: { scale: 100, x: 0, y: 0 },
    days: Array.from({ length: 7 }, () => ({ theme: '歌回', note: '', time1: '20:00', time2: '', highlightLabel: '活动' })),
    modules: {
      message: { enabled: true, title: '留言板', text: '' },
      rank: { enabled: true, title: '上周榜单', subtitle: '', names: ['', '', ''] },
      qr: { enabled: false, caption: '粉丝群' },
      benefits: { enabled: false, title: '福利', text: '' },
    },
    decorations: {},
  };
}

function fixture(t, options = {}) {
  const scratch = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, 'weekly-schedule-unit-'));
  const target = path.join(root, 'chosen.png');
  const windows = [];
  const sessions = [];
  const dialog = { showSaveDialog: async (_window, settings) => {
    dialog.settings = settings;
    return { canceled: false, filePath: target };
  } };
  const nativeImage = { createFromBuffer: bytes => ({
    isEmpty: () => !bytes.subarray(0, 8).equals(png().subarray(0, 8)),
    getSize: () => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }),
  }) };
  class Window {
    constructor(settings) {
      this.settings = settings;
      this.destroyed = false;
      windows.push(this);
      this.webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler: handler => { this.openHandler = handler; },
        executeJavaScript: async script => {
          this.script = script;
          return {
            width: options.renderWidth || 1920, height: 1080,
            viewportWidth: options.viewportWidth || 1920, viewportHeight: options.viewportHeight || 1080,
            overflow: options.overflow || [],
          };
        },
        capturePage: async rect => {
          this.captures = (this.captures || 0) + 1;
          this.rect = rect;
          if (this.captures <= (options.captureVizFailures || 0)) throw new Error('UnknownVizError');
          if (options.captureError) throw new Error('private C:/data/render-failed');
          return {
            toPNG: () => png(options.captureWidth || 1920),
            resize: size => {
              this.resized = size;
              return { toPNG: () => png(options.resizeFails ? 1900 : size.width, size.height) };
            },
          };
        },
      });
    }
    loadURL(url, settings) {
      this.url = url;
      this.loadSettings = settings;
      return options.load ? options.load() : Promise.resolve();
    }
    setContentSize() {}
    destroy() { this.destroyed = true; }
    isDestroyed() { return this.destroyed; }
  }
  const controller = createWeeklyScheduleExportController({
    app: { getPath: () => path.join(root, 'LIRA.exe') }, BrowserWindow: Window, dialog, nativeImage,
    session: { fromPartition(name, settings) {
      const isolated = {
        name, settings, cleared: false,
        setPermissionCheckHandler(handler) { this.checkPermission = handler; },
        setPermissionRequestHandler(handler) { this.requestPermission = handler; },
        webRequest: { onBeforeRequest(handler) { isolated.filter = handler; } },
        async clearStorageData() { this.cleared = true; },
      };
      sessions.push(isolated);
      return isolated;
    } },
    getBaseUrl: () => BASE_URL, getSessionToken: () => 'synthetic-session', getMainWindow: () => null,
    ...(options.fileSystem ? { fileSystem: options.fileSystem } : {}),
  });
  t.after(() => {
    controller.dispose();
    assert.ok(root.startsWith(scratch + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { controller, root, target, windows, sessions, dialog, nativeImage };
}

test('weekly PNG export uses only the authenticated fixed page and isolates its renderer', async t => {
  const f = fixture(t, { captureWidth: 3840 });
  const result = await f.controller.exportPng(template());
  assert.equal(result.saved, true);
  const bytes = fs.readFileSync(result.filePath);
  assert.equal(bytes.readUInt32BE(16), 1920);
  assert.equal(bytes.readUInt32BE(20), 1080);
  const win = f.windows[0];
  assert.equal(win.url, `${BASE_URL}/weekly-schedule-export`);
  assert.equal(win.loadSettings.extraHeaders, 'Authorization: Bearer synthetic-session\n');
  assert.equal(win.settings.webPreferences.preload, undefined);
  assert.equal(win.settings.webPreferences.sandbox, true);
  assert.equal(win.settings.webPreferences.contextIsolation, true);
  assert.equal(win.settings.webPreferences.nodeIntegration, false);
  assert.equal(win.settings.webPreferences.session, f.sessions[0]);
  assert.equal(f.sessions[0].settings.cache, false);
  assert.equal(f.sessions[0].checkPermission(), false);
  assert.equal(win.destroyed, true);
  assert.equal(f.sessions[0].cleared, true);
  assert.equal(f.sessions[0].filter, null);
  assert.match(f.dialog.settings.defaultPath, /测试主播_2026-11-09\.png$/);
  assert.equal(path.dirname(f.dialog.settings.defaultPath), path.join(f.root, '周表'));
  assert.ok(f.dialog.settings.properties.includes('showOverwriteConfirmation'));
  assert.deepEqual(fs.readdirSync(f.root).filter(name => name.endsWith('.tmp')), []);
});

test('cancelling the save dialog does not render or write a PNG', async t => {
  const f = fixture(t);
  f.dialog.showSaveDialog = async () => ({ canceled: true });
  assert.equal((await f.controller.exportPng(template())).cancelled, true);
  assert.equal(f.windows.length, 0);
  assert.equal(fs.existsSync(f.target), false);
});

test('a transient offscreen compositor failure retries one fresh capture', async t => {
  const f = fixture(t, { captureVizFailures: 1 });
  assert.equal((await f.controller.exportPng(template())).saved, true);
  assert.equal(f.windows[0].captures, 2);
  const repeated = fixture(t, { captureVizFailures: 2 });
  assert.equal((await repeated.controller.exportPng(template())).ok, false);
  assert.equal(repeated.windows[0].captures, 2, 'Repeated compositor failures must stop after one retry.');
});

test('a render or image size failure preserves an existing destination and hides internal errors', async t => {
  for (const options of [{ captureError: true }, { captureWidth: 3000, resizeFails: true },
    { renderWidth: 1900 }, { viewportWidth: 1708, viewportHeight: 913 }, { overflow: ['留言正文'] }]) {
    const f = fixture(t, options);
    fs.writeFileSync(f.target, 'keep-original');
    const result = await f.controller.exportPng(template());
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.error, /C:\/data|render-failed/);
    assert.equal(fs.readFileSync(f.target, 'utf8'), 'keep-original');
    assert.equal(f.windows[0].destroyed, true);
    assert.equal(f.sessions[0].cleared, true);
  }
});

test('write failure removes its scratch image and leaves the original destination intact', async t => {
  const fileSystem = { ...fs.promises, rename: async () => { throw Object.assign(new Error('disk'), { code: 'EPERM' }); } };
  const f = fixture(t, { fileSystem });
  fs.writeFileSync(f.target, 'keep-original');
  const result = await f.controller.exportPng(template());
  assert.equal(result.ok, false);
  assert.equal(fs.readFileSync(f.target, 'utf8'), 'keep-original');
  assert.equal(fs.readdirSync(f.root).some(name => name.endsWith('.tmp')), false);
});

test('concurrent exports are rejected and cancellation releases a loading window without writing', async t => {
  let finishLoad;
  const f = fixture(t, { load: () => new Promise(resolve => { finishLoad = resolve; }) });
  const first = f.controller.exportPng(template());
  while (!finishLoad) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.controller.exportPng(template())).ok, false);
  const session = f.sessions[0];
  for (const [url, allowed] of [
    [`${BASE_URL}/js/admin/weekly-schedule/renderer.js`, true],
    [`${BASE_URL}/font-library/kuaile`, true],
    [`${BASE_URL}/api/state`, false],
    ['https://example.com/portrait.png', false],
  ]) {
    session.filter({ url }, result => assert.equal(result.cancel, !allowed));
  }
  assert.equal(f.windows[0].openHandler().action, 'deny');
  let blocked = false;
  f.windows[0].webContents.emit('will-redirect', { preventDefault: () => { blocked = true; } });
  assert.equal(blocked, true);
  f.controller.cancel();
  assert.equal((await first).cancelled, true);
  finishLoad();
  assert.equal(fs.existsSync(f.target), false);
  assert.equal(f.windows[0].destroyed, true);
  assert.equal(session.filter, null);
  assert.equal(session.cleared, true);
});

test('appearance additions allow older payloads and reject malformed render parameters', t => {
  const { nativeImage } = fixture(t);
  const input = template();
  assert.equal(validateWeeklyScheduleExportTemplate(input, nativeImage).layout, 'scrapbook');
  input.layout = 'nocturne';
  input.portrait.outlineWidth = 12;
  input.logo = { scale: 350, x: 1200, y: -800, rotation: -45, opacity: 55, flip: true };
  input.background = { fit: 'contain', x: 80, y: 20, opacity: 50, blur: 12 };
  input.typography = { theme: 140 };
  input.rank1 = { scale: 125, x: 20, y: -10, shadow: 40, brightness: 115 };
  input.background.offsetX = 120;
  input.customIcon = { scale: 100, x: 0, y: 0, glow: 30 };
  assert.equal(validateWeeklyScheduleExportTemplate(input, nativeImage).logo.scale, 350);
  assert.equal(validateWeeklyScheduleExportTemplate(input, nativeImage).layout, 'nocturne');
  input.portrait.outlineWidth = 31;
  assert.throws(() => validateWeeklyScheduleExportTemplate(input, nativeImage));
  input.portrait.outlineWidth = 12;
  input.rank1.brightness = '115';
  assert.throws(() => validateWeeklyScheduleExportTemplate(input, nativeImage));
  input.rank1.brightness = 115;
  input.customIcon.glow = 101;
  assert.throws(() => validateWeeklyScheduleExportTemplate(input, nativeImage));
  input.customIcon.glow = 30;
  input.background.offsetX = 2000;
  assert.throws(() => validateWeeklyScheduleExportTemplate(input, nativeImage));
  input.background.offsetX = 120;
  input.background.blur = 25;
  assert.throws(() => validateWeeklyScheduleExportTemplate(input, nativeImage));
  input.background.blur = 12;
  input.typography = { theme: '140' };
  assert.throws(() => validateWeeklyScheduleExportTemplate(input, nativeImage));
  input.typography = { theme: 140 };
  input.logo.opacity = null;
  assert.throws(() => validateWeeklyScheduleExportTemplate(input, nativeImage));
});

test('asset validation rejects URLs, oversized bitmaps and excess data before native decoding', t => {
  const { nativeImage } = fixture(t);
  for (const value of ['https://example.com/a.png', 'file:///C:/private.png', 'data:image/svg+xml;base64,PHN2Zy8+']) {
    const input = template();
    input.assets.portrait = value;
    assert.throws(() => validateWeeklyScheduleExportTemplate(input, nativeImage));
  }
  const input = template();
  input.assets.portrait = `data:image/png;base64,${png(9000, 1).toString('base64')}`;
  assert.throws(() => validateWeeklyScheduleExportTemplate(input, { createFromBuffer() { assert.fail('oversized PNG decoded'); } }));
  input.assets.portrait = `data:image/png;base64,${Buffer.alloc(12 * 1024 * 1024 + 1).toString('base64')}`;
  assert.throws(() => validateWeeklyScheduleExportTemplate(input, nativeImage));
  input.assets.portrait = `data:image/png;base64,${png(10, 20).toString('base64')}`;
  assert.equal(validateWeeklyScheduleExportTemplate(input, nativeImage).assets.portrait, input.assets.portrait);
});

test('IPC text ceilings reject unbounded module bodies and ranking cardinality', t => {
  const { nativeImage } = fixture(t);
  const input = template();
  input.modules.message.text = '月'.repeat(1000000);
  assert.throws(() => validateWeeklyScheduleExportTemplate(input, nativeImage));
  input.modules.message.text = '给你一封信';
  input.modules.rank.names = Array(100000).fill('观众');
  assert.throws(() => validateWeeklyScheduleExportTemplate(input, nativeImage));
  input.modules.rank.names = ['小月亮', '星星', '云朵'];
  input.modules.qr.caption = {};
  assert.throws(() => validateWeeklyScheduleExportTemplate(input, nativeImage));
  input.modules.qr.caption = '扫码加入粉丝群';
  assert.equal(validateWeeklyScheduleExportTemplate(input, nativeImage).modules.rank.names.length, 3);
});

test('WebP accepts bounded container dimensions without relying on platform NativeImage codecs', () => {
  const input = template();
  const bytes = Buffer.from('UklGRioAAABXRUJQVlA4TB0AAAAvH8AHEA8wZBMyqvMf8BDTEPqXdpsCEf2fAHq95QA=', 'base64');
  input.assets.portrait = `data:image/webp;base64,${bytes.toString('base64')}`;
  const nativeImage = { createFromBuffer() { assert.fail('WebP must use the Chromium decoder'); } };
  assert.equal(validateWeeklyScheduleExportTemplate(input, nativeImage).assets.portrait, input.assets.portrait);
  const oversized = Buffer.from(bytes);
  oversized.writeUInt32LE(9000 - 1, 21);
  input.assets.portrait = `data:image/webp;base64,${oversized.toString('base64')}`;
  assert.throws(() => validateWeeklyScheduleExportTemplate(input, nativeImage));
  input.assets.portrait = `data:image/webp;base64,${bytes.subarray(0, 24).toString('base64')}`;
  assert.throws(() => validateWeeklyScheduleExportTemplate(input, nativeImage));
});

test('the weekly IPC channel reuses main-frame authorization and cancels its owner on navigation', async () => {
  const handlers = new Map();
  const frame = { url: `${BASE_URL}/admin` };
  const contents = Object.assign(new EventEmitter(), { mainFrame: frame });
  const window = { isDestroyed: () => false, webContents: contents };
  let exported = 0;
  let cancelled = 0;
  let disposed = 0;
  const dispose = registerWeeklyScheduleIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
    controller: { exportPng: async () => { exported++; return { ok: true }; },
      cancel: () => { cancelled++; }, dispose: () => { disposed++; } },
    getMainWindow: () => window, getDesktopBaseUrl: () => BASE_URL,
  });
  const invoke = handlers.get('weekly-schedule:export-png');
  assert.equal((await invoke(undefined, {})).error, 'IPC_SOURCE_INVALID');
  assert.equal((await invoke({ sender: contents, senderFrame: { url: frame.url } }, {})).error, 'IPC_SOURCE_INVALID');
  assert.equal(exported, 0);
  const event = { sender: contents, senderFrame: frame };
  assert.equal((await invoke(event)).error, 'IPC_ARGUMENTS_INVALID');
  assert.equal((await invoke(event, {}, '/arbitrary')).error, 'IPC_ARGUMENTS_INVALID');
  assert.equal((await invoke(event, {})).ok, true);
  contents.emit('did-start-navigation', {}, '/', false, false);
  contents.emit('did-start-navigation', {}, '/', true, true);
  assert.equal(cancelled, 0);
  contents.emit('did-start-navigation', {}, '/', false, true);
  assert.equal(cancelled, 1);
  dispose();
  assert.equal(disposed, 1);
  assert.equal(handlers.size, 0);
  assert.equal(contents.listenerCount('did-start-navigation'), 0);
  assert.equal(contents.listenerCount('destroyed'), 0);
});

test('the fixed weekly export page remains management-authenticated and receives no credential bootstrap', async () => {
  async function request(headers) {
    return new Promise(resolve => {
      let status;
      servePageOrAsset(PUBLIC_DIR, { method: 'GET', headers }, {
        setHeader() {}, writeHead(value) { status = value; },
        end(body) { resolve({ status, body: String(body) }); },
      }, new URL(`${BASE_URL}/weekly-schedule-export`), 'synthetic-session');
    });
  }
  assert.equal((await request({})).status, 401);
  const allowed = await request({ authorization: 'Bearer synthetic-session' });
  assert.equal(allowed.status, 200);
  assert.doesNotMatch(allowed.body, /synthetic-session|lira-overlay-bootstrap|__API_TOKEN__/);
  assert.match(allowed.body, /weekly-schedule\/export-page\.js/);
});
