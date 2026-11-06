'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { build, ...packagedMetadata } = require('../../package.json');

function loadUpdateManager(t, suppliedUpdater) {
  const Module = require('node:module');
  const originalLoad = Module._load;
  const modulePath = require.resolve('../../src/electron/update-manager');
  const cachedModule = require.cache[modulePath];
  const updater = suppliedUpdater || Object.assign(new EventEmitter(), { app: {}, setFeedURL(options) { this.feed = options; }, quitAndInstall() {} });
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
  manager.configureAutoUpdater({ updater: suppliedUpdater, onStateChange: (state) => states.push(state), writeLog: (...args) => logs.push(args) });
  return { manager, updater, states, logs };
}

test('packaged startup leaves the update feed to app-update.yml and enables automatic differential downloads', t => {
  const { updater } = loadUpdateManager(t);
  assert.equal(updater.feed, undefined);
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.disableDifferentialDownload, false);
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

test('NSIS downloads reuse local blocks and retain full-download and integrity fallbacks', async t => {
  const http = require('node:http');
  const { once } = require('node:events');
  const { createHash } = require('node:crypto');
  const { gzipSync } = require('node:zlib');
  const { NsisUpdater } = require('electron-updater');
  const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor');
  const { CURRENT_APP_INSTALLER_FILE_NAME } = require('builder-util-runtime');
  const blockSize = 64 * 1024;
  const blocks = [1, 2, 3, 4, 5, 6].map(value => Buffer.alloc(blockSize, value));
  const oldBlocks = blocks.slice(0, 4);
  const newBlocks = [blocks[0], blocks[4], blocks[1], blocks[5]];
  const installer = Buffer.concat(newBlocks);
  const digest = bytes => createHash('sha512').update(bytes).digest('base64');
  const blockmap = entries => gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0,
    checksums: entries.map(digest), sizes: entries.map(entry => entry.length) }] }));

  for (const scenario of ['differential', 'cold-cache', 'missing-blockmap', 'range-rejected', 'bad-checksum', 'offline']) {
    await t.test(scenario, { timeout: 15000 }, async st => {
      const directory = createScratchDirectory('update-download-', st);
      const requests = [];
      const payload = Buffer.from(installer);
      if (scenario === 'bad-checksum') payload[blockSize] ^= 1;
      const server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        const range = request.headers.range;
        let bytes;
        let status = 200;
        if (pathname === '/latest.yml') {
          bytes = Buffer.from(JSON.stringify({ version: '1.0.1', files: [{ url: 'lira-setup-1.0.1.exe',
            sha512: digest(installer), size: installer.length }] }));
        } else if (pathname.endsWith('.blockmap')) {
          status = scenario === 'missing-blockmap' ? 404 : 200;
          bytes = status === 404 ? Buffer.alloc(0) : blockmap(pathname.includes('1.0.0') ? oldBlocks : newBlocks);
        } else if (pathname === '/lira-setup-1.0.1.exe') {
          if (range) {
            const match = /^bytes=(\d+)-(\d+)$/.exec(range);
            if (scenario === 'range-rejected' || !match) {
              status = 416;
              bytes = Buffer.alloc(0);
            } else {
              const [, start, end] = match.map(Number);
              status = 206;
              bytes = payload.subarray(start, end + 1);
              response.setHeader('Content-Range', `bytes ${start}-${end}/${payload.length}`);
            }
          } else bytes = payload;
        } else {
          status = 404;
          bytes = Buffer.alloc(0);
        }
        requests.push({ pathname, range, status, bytes: bytes.length });
        response.writeHead(status, { 'Content-Length': bytes.length });
        response.end(bytes);
      });
      const closeServer = async () => {
        if (!server.listening) return;
        server.closeAllConnections();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      };
      st.after(closeServer);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const configFile = path.join(directory, 'app-update.yml');
      fs.writeFileSync(configFile, JSON.stringify({ ...build.publish[0],
        url: `http://127.0.0.1:${server.address().port}/`, updaterCacheDirName: 'lira-updater' }));
      const updater = new NsisUpdater(null, { version: '1.0.0', name: 'LIRA', isPackaged: true,
        baseCachePath: directory, userDataPath: directory, appUpdateConfigPath: configFile,
        whenReady: async () => {}, onQuit() {} });
      // Keep the real updater's download/hash pipeline; only adapt HTTP to Node.
      updater.httpExecutor = new ElectronHttpExecutor();
      updater.httpExecutor.createRequest = (options, callback) => http.request({ ...options, agent: false }, callback);
      updater.logger = null;
      const { manager } = loadUpdateManager(st, updater);
      updater.autoDownload = false;
      const helper = await updater.getOrCreateDownloadHelper();
      if (scenario !== 'cold-cache') {
        fs.mkdirSync(helper.cacheDir, { recursive: true });
        fs.writeFileSync(path.join(helper.cacheDir, CURRENT_APP_INSTALLER_FILE_NAME), Buffer.concat(oldBlocks));
      }
      await manager.checkForUpdates();
      if (scenario === 'offline') await closeServer();
      const state = await manager.downloadUpdate();
      if (['bad-checksum', 'offline'].includes(scenario)) {
        assert.equal(state.status, 'error');
        assert.equal(state.canInstall, false);
        assert.equal(updater.installerPath, null);
        return;
      }
      assert.equal(state.status, 'downloaded', state.message);
      assert.equal(digest(fs.readFileSync(updater.installerPath)), digest(installer));
      const downloads = requests.filter(request => request.pathname.endsWith('.exe'));
      if (scenario === 'differential') {
        assert.equal(downloads.filter(request => !request.range).length, 0);
        assert.equal(downloads.reduce((total, request) => total + request.bytes, 0), 2 * blockSize);
        st.diagnostic(`Installer bytes: ${2 * blockSize} downloaded / ${installer.length} full`);
        const before = requests.length;
        await closeServer();
        assert.equal((await manager.downloadUpdate()).status, 'downloaded');
        assert.equal(requests.length, before, 'a validated pending installer must be reusable offline');
      } else {
        assert.equal(downloads.filter(request => !request.range && request.status === 200).length, 1);
      }
    });
  }
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
