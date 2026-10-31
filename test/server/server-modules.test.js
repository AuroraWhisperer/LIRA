'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('optional admin launcher handles asynchronous spawn failure and stays disabled by default', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const { EventEmitter } = require('node:events');
  const child = new EventEmitter();
  let spawns = 0;
  let unrefs = 0;
  child.unref = () => { unrefs++; };
  const messages = [];
  const processStub = { env: {}, platform: 'win32' };
  const moduleStub = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../src/server/admin-launcher'), 'utf8'), {
    module: moduleStub,
    process: processStub,
    require: () => ({ spawn() { spawns++; return child; } }),
    console: { log: (message) => messages.push(message), warn: (message) => messages.push(message) },
  });
  moduleStub.exports.openAdminPageIfNeeded('http://127.0.0.1:5000');
  assert.equal(spawns, 0);
  processStub.env.AUTO_OPEN_ADMIN = '1';
  moduleStub.exports.openAdminPageIfNeeded('http://127.0.0.1:5000');
  assert.equal(spawns, 1);
  assert.equal(unrefs, 1);
  assert.doesNotThrow(() => child.emit('error', new Error('spawn cmd ENOENT')));
  assert.deepEqual(messages, [
    'Open admin page manually: http://127.0.0.1:5000/admin',
    'Could not open browser automatically: spawn cmd ENOENT',
  ]);
});

test('server compatibility wrappers reuse one runtime and preserve stop defaults', async () => {
  const { createServerCompatibility } = require('../../src/server/compatibility-runtime');
  const calls = [];
  const runtime = {
    start: (options) => calls.push(['start', options]),
    stop: (options) => calls.push(['stop', options]),
    setPreShutdownHook: (hook) => calls.push(['hook', hook]),
    persistPlaybackSnapshot: (payload, clientId) => ({ payload, clientId }),
    getApiToken: () => 'token',
  };
  let factoryCalls = 0;
  const compatibility = createServerCompatibility((options) => {
    factoryCalls += 1;
    calls.push(['factory', options]);
    return runtime;
  });
  const hook = () => {};

  compatibility.startServer({ dataDir: 'data-a', startPort: 0 });
  compatibility.setPreShutdownHook(hook);
  compatibility.shutdownApplication();

  assert.equal(factoryCalls, 1);
  assert.equal(compatibility.getApiToken(), 'token');
  assert.deepEqual(calls, [
    ['factory', { dataDir: 'data-a' }],
    ['start', { dataDir: 'data-a', startPort: 0 }],
    ['hook', hook],
    ['stop', { exitProcess: true }],
  ]);
});

test('server API context keeps route domains explicit and publishes lyric state', () => {
  const { createApiContext } = require('../../src/server/api-context');
  const noop = () => {};
  const domainServices = {
    songs: {
      list: noop,
      save: noop,
      delete: noop,
      toggle: noop,
      import: noop,
      listCategories: noop,
      count: noop,
    },
    queue: { add: noop, handleAction: noop },
    superChats: { handleAction: noop },
    gifts: {
      resetSprint: noop,
      getHistory: noop,
      getBlindBoxStats: noop,
      getBlindBoxAnalysis: noop,
      search: noop,
      clearRecent: noop,
    },
    overtime: {
      getOverview: noop,
      setTime: noop,
      act: noop,
      setBackground: noop,
      replaceRules: noop,
    },
    data: {
      clearSongLibrary: noop,
      clearSuperChats: noop,
      clearPlayback: noop,
      clearGifts: noop,
      clearAll: noop,
      getSchemaVersions: () => ({ song: 3 }),
      getRetentionStats: noop,
      runRetention: noop,
    },
    playback: { saveQueueState: noop },
    theme: { get: noop },
  };
  const published = [];
  const aiConfigChanges = [];
  const clearRemote = () => {};
  const context = createApiContext({
    maxBodyBytes: 1024,
    sessionToken: 'session-token',
    broadcastSnapshot: noop,
    giftSync: { clearRemote },
    domainServices,
    publishLyricState: (state) => published.push(state),
    publishLyricTimeline: noop,
    weSingCapture: {
      getStatus: noop,
      setCachePath: noop,
      setLyricOffsetMs: noop,
      setActive: noop,
      refresh: noop,
    },
    bilibili: {
      liveStatus: { connected: false },
      configure: noop,
      reconnect: noop,
      updateStatus: noop,
      auth: null,
      danmakuSender: { getState: noop, send: noop },
    },
    ai: {
      configStore: { getConfig: () => ({ enabled: false, trigger: '' }), getPublicConfig: noop, updateConfig: noop },
      service: {
        updateConfig: input => { aiConfigChanges.push(input); return input; },
        getStatus: noop,
        listModels: noop,
        testConfiguration: noop,
        testProvider: noop,
      },
    },
    settings: {
      defaults: { theme: 'default' },
      store: { getSettings: noop, setSetting: noop },
    },
    system: {
      rootDir: 'root',
      dataDir: 'data',
      songDbPath: 'song.db',
      superChatDbPath: 'sc.db',
      giftDbPath: 'gift.db',
      musicDbPath: 'music.db',
      checkinDbPath: 'checkin.db',
      liveStatus: { connected: false },
      getState: noop,
      shutdown: noop,
    },
    music: {
      registry: {},
      lyrics: {},
      apiCacheDir: 'api-cache',
      lyricCacheDir: 'lyric-cache',
    },
  });

  assert.equal(context.maxBodyBytes, 1024);
  assert.equal(context.sessionToken, 'session-token');
  assert.equal(context.songs.list, domainServices.songs.list);
  assert.equal(context.gifts.clearRecent, domainServices.gifts.clearRecent);
  assert.equal(context.giftSync.clearRemote, clearRemote);
  assert.equal('debug' in context, false);
  assert.equal(context.playback, domainServices.playback);
  assert.deepEqual(context.ai.updateConfig({ enabled: false }), { enabled: false });
  assert.deepEqual(aiConfigChanges, [{ enabled: false }]);
  context.playbackLyrics.publish({ trackTitle: '测试' });
  assert.deepEqual(published, [{ trackTitle: '测试' }]);
  assert.deepEqual(context.system.getHealth().schemaVersions, { song: 3 });
});

test('retired gift debug API is not registered', async () => {
  const { handleApi } = require('../../src/server/api-routes');
  let status = 0;
  let body = '';
  const response = {
    writeHead(value) {
      status = value;
    },
    end(value) {
      body = String(value || '');
    },
  };

  await handleApi(
    { maxBodyBytes: 1024, sessionToken: 'synthetic-token' },
    { method: 'GET', headers: { authorization: 'Bearer synthetic-token' } },
    response,
    new URL('http://127.0.0.1/api/debug/gift-messages'),
  );

  assert.equal(status, 404);
  assert.equal(JSON.parse(body).error, 'API 接口不存在');
});
