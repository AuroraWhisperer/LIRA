'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { build, ...packagedMetadata } = require('../../package.json');

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
    if (request === '../../package.json' && parent.filename === modulePath) return packagedMetadata;
    return originalLoad.call(this, request, parent, isMain);
  });
  delete require.cache[modulePath];
  t.after(() => {
    delete require.cache[modulePath];
    if (cachedModule) require.cache[modulePath] = cachedModule;
  });
  const manager = require(modulePath);
  const states = [];
  const logs = [];
  manager.configureAutoUpdater({ onStateChange: (state) => states.push(state), writeLog: (...args) => logs.push(args) });
  return { manager, updater, states, logs };
}

test('packaged startup leaves the update feed to app-update.yml and preserves automatic full downloads', t => {
  const { updater } = loadUpdateManager(t);
  assert.equal(updater.feed, undefined);
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.disableDifferentialDownload, true);
});

for (const operation of ['checkForUpdates', 'downloadUpdate']) {
  test(`${operation} reports a missing CDN manifest as an error when the updater emits and rejects`, async (t) => {
    const { manager, updater, states, logs } = loadUpdateManager(t);
    const error = new Error('404 https://assets.lirahub.cn/downloads/latest.yml');
    updater[operation] = async () => {
      updater.emit('error', error);
      throw error;
    };
    const state = await manager[operation]();
    assert.equal(state.status, 'error');
    assert.equal(states.at(-1).status, 'error');
    assert.match(state.message, /更新清单/);
    assert.equal(state.canDownload, false);
    assert.equal(state.canInstall, false);
    assert.equal(logs.length, 1);
    assert.equal(logs[0][1], error);
  });

  test(`${operation} logs rejection-only failures on every retry`, async (t) => {
    const { manager, updater, logs } = loadUpdateManager(t);
    const error = new Error('Cannot download "https://assets.lirahub.cn/downloads/lira-setup-5.7.7.exe", status 404');
    updater[operation] = async () => { throw error; };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const state = await manager[operation]();
      assert.equal(state.status, 'error');
      assert.equal(logs.length, attempt);
      assert.equal(logs.at(-1)[1], error);
    }
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
  'Windows updater reads packaged configuration without build metadata and keeps its HTTP executor and installation-drive cache',
  {
    skip: process.platform !== 'win32',
  },
  async (t) => {
    const Module = require('node:module');
    const originalLoad = Module._load;
    const modulePath = require.resolve('../../src/electron/update-manager');
    const updaterPath = require.resolve('electron-updater');
    const cachedModule = require.cache[modulePath];
    const cachedUpdater = require.cache[updaterPath];
    const directory = createScratchDirectory('packaged-updater-', t);
    const configFile = path.join(directory, 'app-update.yml');
    fs.writeFileSync(configFile, JSON.stringify({ ...build.publish[0], updaterCacheDirName: 'lira-updater' }));
    const app = Object.assign(new EventEmitter(), {
      getVersion: () => '4.1.0',
      getName: () => 'LIRA',
      getPath: (name) => (name === 'exe' ? 'D:\\Apps\\LIRA\\LIRA.exe' : 'D:\\Apps\\LIRA\\data\\browser'),
      isPackaged: true,
      whenReady: async () => {},
    });
    try {
      Module._load = function (request, parent, isMain) {
        if (request === 'electron') return { app };
        if (request === '../../package.json' && parent.filename === modulePath) return packagedMetadata;
        return originalLoad.call(this, request, parent, isMain);
      };
      delete require.cache[updaterPath];
      delete require.cache[modulePath];
      require(modulePath).configureAutoUpdater({});
      const updater = require('electron-updater').autoUpdater;
      assert.equal(updater.httpExecutor.constructor.name, 'ElectronHttpExecutor');
      updater.updateConfigPath = configFile;
      updater.stagingUserIdPromise = { value: Promise.resolve('fixture-staging-id') };
      const requested = [];
      const sha512 = Buffer.alloc(64, 7).toString('base64');
      updater.httpExecutor.request = async options => {
        requested.push(new URL(options.path, `${options.protocol}//${options.hostname}`));
        return `version: 4.1.1\nfiles:\n  - url: lira-setup-4.1.1.exe\n    sha512: ${sha512}\n    size: 123\npath: lira-setup-4.1.1.exe\n`;
      };
      const { info, provider } = await updater.getUpdateInfoAndProvider();
      assert.equal(requested.length, 1);
      assert.equal(requested[0].origin, 'https://assets.lirahub.cn');
      assert.equal(requested[0].pathname, '/downloads/latest.yml');
      const files = provider.resolveFiles(info);
      assert.equal(files[0].url.href, 'https://assets.lirahub.cn/downloads/lira-setup-4.1.1.exe');
      assert.equal(files[0].info.sha512, sha512);
      // Resolve the actual download helper using the same packaged configuration.
      updater.logger = null;
      const helper = await updater.getOrCreateDownloadHelper();
      assert.equal(helper.cacheDir, path.join('D:\\Apps\\LIRA', 'updates', 'lira-updater'));
    } finally {
      delete require.cache[modulePath];
      delete require.cache[updaterPath];
      if (cachedModule) require.cache[modulePath] = cachedModule;
      if (cachedUpdater) require.cache[updaterPath] = cachedUpdater;
      Module._load = originalLoad;
    }
  },
);
