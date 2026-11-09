'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const MODULE_PATH = require.resolve('../../src/electron/desktop-resource-integrity');
const BASE_URL = 'http://127.0.0.1:3000';

// Loads the adapter with original-fs and the manager replaced, and returns the options it passes to the manager.
function loadAdapter(t, { mainWindow = null } = {}) {
  const originalFs = { synthetic: 'original-fs' };
  const resourcesPath = 'C:\\synthetic-lira\\resources';
  const hadResourcesPath = Object.hasOwn(process, 'resourcesPath');
  const previousResourcesPath = process.resourcesPath;
  process.resourcesPath = resourcesPath;
  t.after(() => {
    if (hadResourcesPath) process.resourcesPath = previousResourcesPath;
    else delete process.resourcesPath;
  });
  let managerOptions;
  const manager = { synthetic: 'manager' };
  const load = Module._load;
  t.mock.method(Module, '_load', function loadStub(request, parent, isMain) {
    if (parent?.filename === MODULE_PATH && request === 'original-fs') return originalFs;
    if (parent?.filename === MODULE_PATH && request === './resource-integrity-manager') {
      return {
        createResourceIntegrityManager(options) {
          managerOptions = options;
          return manager;
        },
      };
    }
    return load.call(this, request, parent, isMain);
  });
  delete require.cache[MODULE_PATH];
  t.after(() => delete require.cache[MODULE_PATH]);
  const { createDesktopResourceIntegrity } = require(MODULE_PATH);
  createDesktopResourceIntegrity({
    app: { getVersion: () => '7.0.0', isPackaged: true },
    getMainWindow: () => mainWindow,
    getDesktopBaseUrl: () => BASE_URL,
    writeLog() {},
  });
  return { managerOptions, originalFs, resourcesPath };
}

function createWindow(url) {
  const sent = [];
  return {
    sent,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    webContents: {
      destroyed: false,
      isDestroyed() {
        return this.destroyed;
      },
      mainFrame: { url },
      send: (channel, payload) => sent.push([channel, payload]),
    },
  };
}

test('packaged resource checks read the unpacked resources directory through original-fs', (t) => {
  const { managerOptions, originalFs, resourcesPath } = loadAdapter(t);
  assert.equal(managerOptions.fs, originalFs);
  assert.equal(managerOptions.resourcesDir, resourcesPath);
});

test('integrity state reaches only a live main window on an exact desktop page', (t) => {
  const mainWindow = createWindow(`${BASE_URL}/admin`);
  const { managerOptions } = loadAdapter(t, { mainWindow });
  const state = { revision: 1 };
  for (const [url, expected] of [
    [`${BASE_URL}/admin?desktop=1`, true],
    [`${BASE_URL}/license`, false],
    [`${BASE_URL}/admin/extra`, false],
    ['http://127.0.0.1:3001/admin', false],
    ['http://localhost:3000/admin', false],
    [undefined, false],
  ]) {
    mainWindow.webContents.mainFrame.url = url;
    mainWindow.sent.length = 0;
    managerOptions.onStateChange(state);
    assert.deepEqual(mainWindow.sent, expected ? [['desktop:resource-integrity-state', state]] : [], String(url));
  }

  mainWindow.webContents.mainFrame.url = `${BASE_URL}/admin`;
  mainWindow.sent.length = 0;
  mainWindow.webContents.destroyed = true;
  managerOptions.onStateChange(state);
  mainWindow.webContents.destroyed = false;
  mainWindow.destroyed = true;
  managerOptions.onStateChange(state);
  assert.deepEqual(mainWindow.sent, []);
});

test('integrity state is dropped while there is no main window', (t) => {
  const { managerOptions } = loadAdapter(t);
  assert.doesNotThrow(() => managerOptions.onStateChange({ revision: 1 }));
});
