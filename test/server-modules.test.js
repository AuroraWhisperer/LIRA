'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('server compatibility wrappers reuse one runtime and preserve stop defaults', async () => {
  const {
    createServerCompatibility,
  } = require('../src/server/compatibility-runtime');
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
  const { createApiContext } = require('../src/server/api-context');
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
  const context = createApiContext({
    maxBodyBytes: 1024,
    sessionToken: 'session-token',
    broadcastSnapshot: noop,
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
      configStore: { getPublicConfig: noop, updateConfig: noop },
      service: {
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
  assert.equal('debug' in context, false);
  assert.equal(context.playback, domainServices.playback);
  context.playbackLyrics.publish({ trackTitle: '测试' });
  assert.deepEqual(published, [{ trackTitle: '测试' }]);
  assert.deepEqual(context.system.getHealth().schemaVersions, { song: 3 });
});

test('retired gift debug API is not registered', async () => {
  const { handleApi } = require('../src/server/api-routes');
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
    { maxBodyBytes: 1024, sessionToken: '' },
    { method: 'GET', headers: {} },
    response,
    new URL('http://127.0.0.1/api/debug/gift-messages'),
  );

  assert.equal(status, 404);
  assert.equal(JSON.parse(body).error, 'API 接口不存在');
});
