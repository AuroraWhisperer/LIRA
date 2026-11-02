'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const path = require('node:path');

function loadUpdateManager(t) {
  const Module = require('node:module');
  const originalLoad = Module._load;
  const modulePath = require.resolve('../../src/electron/update-manager');
  const cachedModule = require.cache[modulePath];
  const updater = Object.assign(new EventEmitter(), { app: {}, setFeedURL(options) { this.feed = options; }, quitAndInstall() {} });
  const app = {
    getVersion: () => '5.2.7',
    getPath: () => path.resolve('tmp/updater-test/LIRA.exe'),
    isPackaged: true,
    releaseSingleInstanceLock() {},
  };
  t.mock.method(Module, '_load', function (request, parent, isMain) {
    if (request === 'electron') return { app };
    if (request === 'electron-updater') return { autoUpdater: updater };
    return originalLoad.call(this, request, parent, isMain);
  });
  delete require.cache[modulePath];
  t.after(() => {
    delete require.cache[modulePath];
    if (cachedModule) require.cache[modulePath] = cachedModule;
  });
  const manager = require(modulePath);
  const states = [];
  manager.configureAutoUpdater({ onStateChange: (state) => states.push(state) });
  return { manager, updater, states };
}

test('updates use the configured CDN generic feed and preserve automatic full downloads', t => {
  const { updater } = loadUpdateManager(t);
  assert.deepEqual(updater.feed, { provider: 'generic', url: 'https://assets.lirahub.cn/downloads/' });
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.disableDifferentialDownload, true);
});

for (const operation of ['checkForUpdates', 'downloadUpdate']) {
  test(`${operation} reports a missing CDN manifest as an error when the updater emits and rejects`, async (t) => {
    const { manager, updater, states } = loadUpdateManager(t);
    updater[operation] = async () => {
      const error = new Error('404 https://assets.lirahub.cn/downloads/latest.yml');
      updater.emit('error', error);
      throw error;
    };
    const state = await manager[operation]();
    assert.equal(state.status, 'error');
    assert.equal(states.at(-1).status, 'error');
    assert.match(state.message, /更新清单/);
    assert.equal(state.canDownload, false);
    assert.equal(state.canInstall, false);
  });
}

test('download failure and retry discard the previous progress before accepting new progress', async (t) => {
  const { manager, updater, states } = loadUpdateManager(t);
  updater.emit('download-progress', { percent: 80, transferred: 8, total: 10 });
  updater.emit('error', new Error('network timeout'));
  assert.equal(manager.getUpdateState().status, 'error');
  assert.equal(manager.getUpdateState().progress, null);

  updater.emit('update-downloaded', { version: '5.2.8' });
  updater.downloadUpdate = async () => { throw new Error('network timeout'); };
  const state = await manager.downloadUpdate();
  assert.equal(states.at(-2).status, 'downloading');
  assert.equal(states.at(-2).progress, null);
  assert.equal(state.status, 'error');
  assert.equal(state.progress, null);
});

test('installation clears downloaded progress while preserving the update version', (t) => {
  const { manager, updater } = loadUpdateManager(t);
  updater.emit('update-downloaded', { version: '5.2.8' });
  const state = manager.installUpdate();
  assert.equal(state.status, 'installing');
  assert.equal(state.progress, null);
  assert.equal(state.updateVersion, '5.2.8');
});

test(
  'Windows updater keeps its HTTP executor while caching on the installation drive',
  {
    skip: process.platform !== 'win32',
  },
  async () => {
    const Module = require('node:module');
    const originalLoad = Module._load;
    const modulePath = require.resolve('../../src/electron/update-manager');
    const updaterPath = require.resolve('electron-updater');
    const cachedUpdater = require.cache[updaterPath];
    const app = Object.assign(new EventEmitter(), {
      getVersion: () => '4.1.0',
      getName: () => 'LIRA',
      getPath: (name) => (name === 'exe' ? 'D:\\Apps\\LIRA\\LIRA.exe' : 'D:\\Apps\\LIRA\\data\\browser'),
      isPackaged: true,
    });
    try {
      Module._load = function (request, parent, isMain) {
        if (request === 'electron') return { app };
        return originalLoad.call(this, request, parent, isMain);
      };
      delete require.cache[updaterPath];
      delete require.cache[modulePath];
      require(modulePath).configureAutoUpdater({});
      const updater = require('electron-updater').autoUpdater;
      assert.equal(updater.httpExecutor.constructor.name, 'ElectronHttpExecutor');
      const provider = await updater.clientPromise;
      const requested = [];
      const sha512 = Buffer.alloc(64, 7).toString('base64');
      provider.httpRequest = async url => {
        requested.push(url);
        return `version: 4.1.1\nfiles:\n  - url: lira-setup.exe\n    sha512: ${sha512}\n    size: 123\n`;
      };
      const info = await provider.getLatestVersion();
      assert.equal(requested.length, 1);
      assert.equal(requested[0].origin, 'https://assets.lirahub.cn');
      assert.equal(requested[0].pathname, '/downloads/latest.yml');
      const files = provider.resolveFiles(info);
      assert.equal(files[0].url.href, 'https://assets.lirahub.cn/downloads/lira-setup.exe');
      assert.equal(files[0].info.sha512, sha512);
      // Resolve the actual library download helper without disk or network access.
      updater.configOnDisk = {
        value: Promise.resolve({ updaterCacheDirName: 'lira-updater' }),
      };
      updater.logger = null;
      const helper = await updater.getOrCreateDownloadHelper();
      assert.equal(helper.cacheDir, path.join('D:\\Apps\\LIRA', 'updates', 'lira-updater'));
    } finally {
      delete require.cache[modulePath];
      delete require.cache[updaterPath];
      if (cachedUpdater) require.cache[updaterPath] = cachedUpdater;
      Module._load = originalLoad;
    }
  },
);
