'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { createClientAppearance, bindClientAppearanceWindow } = require('../../src/electron/client-appearance');
const { registerClientAppearanceIpc } = require('../../src/electron/ipc/client-appearance-ipc');

function fixture(t, record, overrides = {}) {
  const root = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(root, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(root, 'client-appearance-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const file = path.join(dataDir, 'client-appearance.json');
  if (record !== undefined) fs.writeFileSync(file, record);
  const logs = [];
  const owner = createClientAppearance({ dataDir, writeLog: (...args) => logs.push(args), ...overrides });
  return { owner, file, dataDir, logs };
}

test('appearance defaults without writing and preserves invalid, future or malformed records', (t) => {
  const missing = fixture(t);
  assert.equal(missing.owner.getThemeId(), 'terracotta');
  assert.equal(fs.existsSync(missing.file), false);
  assert.equal(missing.logs.length, 0);
  for (const content of ['{broken', '{"themeId":"future"}', 'null', '{"themeId":{}}']) {
    const f = fixture(t, content);
    assert.equal(f.owner.getThemeId(), 'terracotta');
    assert.equal(fs.readFileSync(f.file, 'utf8'), content);
    assert.equal(f.logs.length, 1);
  }
});

test('appearance accepts only theme IDs, atomically saves ID alone and restores on restart', async (t) => {
  const f = fixture(t, '{"themeId":"classic"}');
  for (const value of [undefined, null, {}, ['neutral'], 'NEUTRAL', '../classic', 'neutral" style="']) {
    assert.deepEqual(await f.owner.setThemeId(value), { ok: false, error: 'CLIENT_THEME_INVALID' });
  }
  assert.equal(f.owner.getThemeId(), 'classic');
  assert.deepEqual(await f.owner.setThemeId('terracotta'), { ok: true, themeId: 'terracotta' });
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file)), { themeId: 'terracotta' });
  assert.equal(createClientAppearance({ dataDir: f.dataDir }).getThemeId(), 'terracotta');
  assert.deepEqual(fs.readdirSync(f.dataDir), ['client-appearance.json']);
});

test('an unreadable record falls back without attempting a repair or exposing its path', (t) => {
  const error = Object.assign(new Error('private-data-path'), { code: 'EACCES' });
  const f = fixture(t, '{"themeId":"classic"}', { fileSystem: { ...fs, readFileSync: () => { throw error; } } });
  assert.equal(f.owner.getThemeId(), 'terracotta');
  assert.equal(fs.readFileSync(f.file, 'utf8'), '{"themeId":"classic"}');
  assert.deepEqual(f.logs, [['client-appearance', { event: 'READ_FALLBACK' }]]);
});

test('failed write or rename keeps committed state and file; later queued writes still succeed', async (t) => {
  for (const failure of ['writeFile', 'rename']) {
    let fail = true;
    const fileSystem = { ...fs, promises: { ...fs.promises, [failure]: async (...args) => {
      if (fail) throw new Error('private-path-must-not-leak');
      return fs.promises[failure](...args);
    } } };
    const f = fixture(t, '{"themeId":"classic"}', { fileSystem });
    assert.deepEqual(await f.owner.setThemeId('terracotta'), { ok: false, error: 'CLIENT_THEME_SAVE_FAILED' });
    assert.equal(f.owner.getThemeId(), 'classic');
    assert.equal(fs.readFileSync(f.file, 'utf8'), '{"themeId":"classic"}');
    assert.deepEqual(fs.readdirSync(f.dataDir), ['client-appearance.json']);
    fail = false;
    assert.deepEqual(await f.owner.setThemeId('neutral'), { ok: true, themeId: 'neutral' });
  }
});

test('theme saves retry temporary rename locks but preserve state on persistent or unrelated errors', async (t) => {
  for (const [code, failures, succeeds, attempts] of [
    ['EPERM', 1, true, 2],
    ['EBUSY', 2, true, 3],
    ['EPERM', 5, false, 5],
    ['EIO', 1, false, 1],
  ]) {
    let calls = 0;
    const fileSystem = { ...fs, promises: { ...fs.promises, rename: async (...args) => {
      assert.equal(f.owner.getThemeId(), 'classic');
      assert.equal(fs.readFileSync(f.file, 'utf8'), '{"themeId":"classic"}');
      if (++calls <= failures) throw Object.assign(new Error('private-path-must-not-leak'), { code });
      return fs.promises.rename(...args);
    } } };
    const f = fixture(t, '{"themeId":"classic"}', { fileSystem });
    assert.deepEqual(await f.owner.setThemeId('neutral'), succeeds
      ? { ok: true, themeId: 'neutral' }
      : { ok: false, error: 'CLIENT_THEME_SAVE_FAILED' }, `${code}: ${failures} failures`);
    assert.equal(calls, attempts);
    const expected = succeeds ? 'neutral' : 'classic';
    assert.equal(f.owner.getThemeId(), expected);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.file)), { themeId: expected });
    assert.deepEqual(fs.readdirSync(f.dataDir), ['client-appearance.json']);
    assert.deepEqual(f.logs, succeeds ? [] : [['client-appearance', { event: 'WRITE_FAILED' }]]);
  }
});

test('concurrent applications commit in order and snapshots change only after rename', async (t) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let firstStarted;
  const started = new Promise(resolve => { firstStarted = resolve; });
  const seen = [];
  const fileSystem = { ...fs, promises: { ...fs.promises, rename: async (...args) => {
    const nextThemeId = JSON.parse(fs.readFileSync(args[0])).themeId;
    if (seen.length === 0) { firstStarted(); await gate; }
    await fs.promises.rename(...args);
    seen.push(nextThemeId);
  } } };
  const f = fixture(t, undefined, { fileSystem });
  const first = f.owner.setThemeId('classic');
  const second = f.owner.setThemeId('terracotta');
  await started;
  assert.equal(f.owner.getThemeId(), 'terracotta');
  assert.deepEqual(seen, []);
  release();
  assert.deepEqual(await first, { ok: true, themeId: 'classic' });
  assert.deepEqual(await second, { ok: true, themeId: 'terracotta' });
  await f.owner.whenIdle();
  assert.deepEqual(seen, ['classic', 'terracotta']);
  assert.equal(f.owner.getThemeId(), 'terracotta');
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file)), { themeId: 'terracotta' });
});

test('theme IPC applies shared frame policy and validates arguments before storage', async (t) => {
  const { owner } = fixture(t);
  const baseUrl = 'http://127.0.0.1:3000';
  const mainFrame = { url: `${baseUrl}/admin` };
  const webContents = { mainFrame, getURL: () => mainFrame.url };
  const window = { webContents, isDestroyed: () => false, setBackgroundColor() {} };
  const handlers = new Map();
  const dispose = registerClientAppearanceIpc({ ipcMain: { handle: (id, action) => handlers.set(id, action), removeHandler: id => handlers.delete(id) },
    appearance: owner, getMainWindow: () => window, getDesktopBaseUrl: () => baseUrl });
  const invoke = (...args) => handlers.get('desktop:set-client-theme')(...args);
  const event = { sender: webContents, senderFrame: mainFrame };
  assert.deepEqual(await invoke({ ...event, senderFrame: { url: mainFrame.url } }, 'classic'), { ok: false, error: 'IPC_SOURCE_INVALID' });
  assert.equal(owner.getThemeId(), 'terracotta');
  assert.deepEqual(await invoke(event), { ok: false, error: 'IPC_ARGUMENTS_INVALID' });
  assert.deepEqual(await invoke(event, 'classic', 'extra'), { ok: false, error: 'IPC_ARGUMENTS_INVALID' });
  assert.deepEqual(await invoke(event, {}), { ok: false, error: 'CLIENT_THEME_INVALID' });
  assert.deepEqual(await invoke(event, 'classic'), { ok: true, themeId: 'classic' });
  dispose();
  assert.equal(handlers.size, 0);
});

test('native backgrounds follow main-frame navigation only and unbind when the window closes', () => {
  const baseUrl = 'http://127.0.0.1:3000';
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  const colors = [];
  window.setBackgroundColor = color => colors.push(color);
  bindClientAppearanceWindow(window, baseUrl, () => 'terracotta');
  window.webContents.emit('did-start-navigation', {}, `${baseUrl}/admin`, false, true);
  window.webContents.emit('did-start-navigation', {}, `${baseUrl}/license`, false, false);
  window.webContents.emit('did-start-navigation', {}, `${baseUrl}/license`, false, true);
  assert.deepEqual(colors, ['#f8f5ef', '#f7f3ef']);
  window.emit('closed');
  assert.equal(window.webContents.listenerCount('did-start-navigation'), 0);
});
